import { prisma } from "@/lib/db";
import { listAgentRegistry } from "@/lib/ai/agents/registry";
import { createMission, getMission } from "@/lib/ai/coder/missionStore";
import { shipMissionAsPullRequest, type ShipResult } from "@/lib/ai/evolution/ship";

/**
 * ONDEAL AI CORE — §61-65 "System Evolution Console", clôture réelle
 * (06/09/2026).
 *
 * Pipeline complet d'auto-amélioration :
 *   1. Une hypothèse RÉELLE apparaît — soit détectée MÉCANIQUEMENT depuis
 *      les statistiques réelles de l'Agent Registry (detectSignals, jamais
 *      un signal inventé), soit écrite directement par l'Owner
 *      (createOwnerProposal).
 *   2. L'Owner déclenche une VRAIE CoderMission (Phase 3, RÉUTILISÉE sans
 *      modification) qui implémente l'hypothèse dans un workspace isolé —
 *      édite, compile, teste, construit RÉELLEMENT (launchProposalMission).
 *   3. Une fois la mission terminée (succès OU échec — les deux sont une
 *      information réelle), l'Owner relit le résultat réel (diff, logs,
 *      captures) avant toute décision (syncProposalStatus).
 *   4. L'Owner approuve ou rejette (reviewProposal) — jamais l'IA elle-même.
 *   5. Seulement si APPROUVÉ et si la mission a RÉUSSI, l'Owner peut
 *      déclencher la livraison réelle en Pull Request GitHub
 *      (shipProposal → evolution/ship.ts) — l'unique écriture externe de ce
 *      pipeline, gardée par step-up côté route API.
 *
 * "AI self-promotion impossible" (même garantie structurelle que
 * PlatformOwnerSession, §"DELIVERY CONDITION — OWNER IDENTITY") : aucun
 * fichier `supervisor/*.ts` n'importe ce module — un rôle du Supervisor ne
 * peut jamais lui-même créer, approuver ou livrer un EvolutionProposal.
 */

export type EvolutionProposalStatus = "PROPOSED" | "MISSION_LAUNCHED" | "AWAITING_OWNER_REVIEW" | "APPROVED" | "REJECTED" | "SHIPPED";

// Seuils volontairement simples et documentés (§83 : la solution la plus
// simple qui reste correcte) — un rôle doit avoir un échantillon réel non
// négligeable ET un taux de réussite réellement bas pour devenir un signal ;
// jamais un signal sur 1 échec isolé (bruit, pas un vrai motif).
const MIN_MISSIONS_FOR_SIGNAL = 3;
const FAILURE_RATE_THRESHOLD = 0.5;

export interface EvolutionSignal {
  targetArea: string;
  hypothesis: string;
}

/** Scan MÉCANIQUE des statistiques réelles de l'Agent Registry — jamais un signal fabriqué : retourne [] si rien ne franchit le seuil. */
export async function detectSignals(): Promise<EvolutionSignal[]> {
  const agents = await listAgentRegistry();
  const signals: EvolutionSignal[] = [];
  for (const a of agents) {
    if (a.missionCount >= MIN_MISSIONS_FOR_SIGNAL && a.successRate != null && a.successRate < FAILURE_RATE_THRESHOLD) {
      signals.push({
        targetArea: `supervisor — rôle "${a.role}"`,
        hypothesis: `Le rôle "${a.role}" a un taux de réussite réel de ${Math.round(a.successRate * 100)}% sur ${a.missionCount} mission(s) (${a.failureCount} échec(s) réels) — sous le seuil de ${Math.round(FAILURE_RATE_THRESHOLD * 100)}%. Inspecte src/lib/ai/supervisor/catalogue.ts pour ce rôle (prompt, schéma de sortie attendu, contrat) et src/lib/ai/memory/store.ts (scope FAILURE) pour les raisons d'échec déjà enregistrées, puis corrige la cause racine — pas seulement un symptôme. Preuve de succès attendue : de nouvelles missions réelles utilisant ce rôle après correctif, avec un taux de réussite mesuré supérieur.`,
      });
    }
  }
  return signals;
}

/** Persiste les signaux détectés — jamais de doublon (un signal déjà couvert par un EvolutionProposal encore ouvert, quel que soit son statut sauf REJECTED, n'est pas re-proposé). */
export async function detectAndPersistSignals(): Promise<{ created: number; skippedExisting: number }> {
  const signals = await detectSignals();
  let created = 0;
  let skippedExisting = 0;
  for (const signal of signals) {
    const existing = await prisma.evolutionProposal.findFirst({
      where: { targetArea: signal.targetArea, status: { not: "REJECTED" } },
    });
    if (existing) {
      skippedExisting += 1;
      continue;
    }
    await prisma.evolutionProposal.create({
      data: { source: "SYSTEM_ANALYSIS", hypothesis: signal.hypothesis, targetArea: signal.targetArea, status: "PROPOSED" },
    });
    created += 1;
  }
  return { created, skippedExisting };
}

export async function createOwnerProposal(opts: { hypothesis: string; targetArea: string; userId: string }) {
  return prisma.evolutionProposal.create({
    data: { source: "OWNER", hypothesis: opts.hypothesis, targetArea: opts.targetArea, status: "PROPOSED", createdByUserId: opts.userId },
  });
}

export async function listProposals(limit = 50) {
  const proposals = await prisma.evolutionProposal.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return Promise.all(proposals.map((p) => syncProposalStatus(p)));
}

export async function getProposal(id: string) {
  const proposal = await prisma.evolutionProposal.findUnique({ where: { id } });
  if (!proposal) return null;
  return syncProposalStatus(proposal);
}

interface ProposalRow {
  id: string;
  status: string;
  coderMissionId: string | null;
}

/**
 * Fait avancer MISSION_LAUNCHED → AWAITING_OWNER_REVIEW dès que la
 * CoderMission liée a atteint un statut terminal (SUCCEEDED ou FAILED,
 * consulté en lecture RÉELLE, jamais mis en cache) — appelé à chaque
 * lecture plutôt que par un cron séparé, cohérent avec le reste du système
 * (§"jamais une donnée mise en cache présentée comme fraîche").
 */
async function syncProposalStatus<T extends ProposalRow>(proposal: T): Promise<T & { coderMission: Awaited<ReturnType<typeof getMission>> | null }> {
  if (proposal.status !== "MISSION_LAUNCHED" || !proposal.coderMissionId) {
    const mission = proposal.coderMissionId ? await getMission(proposal.coderMissionId) : null;
    return { ...proposal, coderMission: mission };
  }
  const mission = await getMission(proposal.coderMissionId);
  if (mission && (mission.status === "SUCCEEDED" || mission.status === "FAILED")) {
    const updated = await prisma.evolutionProposal.update({ where: { id: proposal.id }, data: { status: "AWAITING_OWNER_REVIEW" } });
    return { ...proposal, ...updated, coderMission: mission };
  }
  return { ...proposal, coderMission: mission };
}

/** Lance la VRAIE CoderMission qui implémente l'hypothèse — même moteur que /api/coder-missions (Phase 3), jamais un exécuteur parallèle inventé pour l'occasion. */
export async function launchProposalMission(proposalId: string, userId: string) {
  const proposal = await prisma.evolutionProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new Error("EvolutionProposal introuvable.");
  if (proposal.status !== "PROPOSED") {
    throw new Error(`EvolutionProposal déjà à l'étape "${proposal.status}" — une mission ne peut être lancée que depuis "PROPOSED" (jamais deux missions pour la même proposition).`);
  }
  const goal = `[System Evolution — ${proposal.targetArea}] ${proposal.hypothesis}`;
  const mission = await createMission({ goal, createdByUserId: userId });
  const updated = await prisma.evolutionProposal.update({ where: { id: proposalId }, data: { status: "MISSION_LAUNCHED", coderMissionId: mission.id } });
  return { proposal: updated, mission };
}

/** Décision Owner — jamais l'IA elle-même (voir commentaire d'en-tête). */
export async function reviewProposal(opts: { proposalId: string; userId: string; decision: "APPROVE" | "REJECT"; note?: string }) {
  const synced = await getProposal(opts.proposalId);
  if (!synced) throw new Error("EvolutionProposal introuvable.");
  if (synced.status !== "AWAITING_OWNER_REVIEW") {
    throw new Error(`EvolutionProposal à l'étape "${synced.status}" — une revue Owner exige "AWAITING_OWNER_REVIEW" (la mission liée doit être terminée, succès ou échec).`);
  }
  if (opts.decision === "APPROVE" && synced.coderMission?.status !== "SUCCEEDED") {
    throw new Error("Impossible d'approuver : la CoderMission liée n'a PAS réussi (SUCCEEDED requis) — jamais une approbation sur un correctif dont on sait déjà qu'il échoue à compiler/tester/construire.");
  }
  return prisma.evolutionProposal.update({
    where: { id: opts.proposalId },
    data: {
      status: opts.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      reviewedByUserId: opts.userId,
      reviewNote: opts.note ?? null,
      reviewedAt: new Date(),
    },
  });
}

/** Unique écriture externe du pipeline — jamais appelée ailleurs qu'une route step-up (voir en-tête). */
export async function shipProposal(opts: { proposalId: string; userId: string }): Promise<{ proposal: unknown; ship: ShipResult }> {
  const proposal = await prisma.evolutionProposal.findUnique({ where: { id: opts.proposalId } });
  if (!proposal) throw new Error("EvolutionProposal introuvable.");
  if (proposal.status !== "APPROVED") {
    throw new Error(`EvolutionProposal à l'étape "${proposal.status}" — la livraison exige "APPROVED" (revue Owner déjà faite).`);
  }
  if (!proposal.coderMissionId) throw new Error("Aucune CoderMission liée — état incohérent.");

  const branchName = `system-evolution/${proposal.id}`;
  const ship = await shipMissionAsPullRequest({
    missionId: proposal.coderMissionId,
    branchName,
    title: `[System Evolution] ${proposal.targetArea}`,
    body: `Hypothèse (${proposal.source === "SYSTEM_ANALYSIS" ? "détectée mécaniquement depuis l'Agent Registry" : "écrite par l'Owner"}) :\n\n${proposal.hypothesis}\n\n---\nCoderMission : ${proposal.coderMissionId}\nEvolutionProposal : ${proposal.id}${proposal.reviewNote ? `\nNote de revue Owner : ${proposal.reviewNote}` : ""}\n\nGénéré et livré via AI Lab → Evolution (System Evolution Console).`,
  });

  const updated = await prisma.evolutionProposal.update({
    where: { id: opts.proposalId },
    data: { status: "SHIPPED", shippedPrUrl: ship.prUrl, shippedBranch: ship.branch, shippedAt: new Date() },
  });
  return { proposal: updated, ship };
}
