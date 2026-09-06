import { prisma } from "@/lib/db";
import type { JobArtifactKind } from "@/lib/ai/jobs/types";
import type { SpecialistOutput } from "@/lib/ai/supervisor/types";

/**
 * ONDEAL AI CORE — PHASE 4 : couche DB du graphe Supervisor (06/09/2026).
 *
 * Réutilise la mécanique de src/lib/ai/coder/missionStore.ts (journal
 * d'ajout, jamais de réécriture — un retry crée une nouvelle ligne
 * `attempt`) mais adaptée à un GRAPHE (clé stable + dépendances) plutôt
 * qu'un index linéaire — voir schema.prisma pour la justification
 * structurelle complète.
 */

const STALE_HEARTBEAT_MS = 10 * 60 * 1000; // même valeur que jobs/store.ts et coder/missionStore.ts

export async function createStorefrontMission(params: {
  goal: string;
  constraints?: Record<string, unknown>;
  createdByUserId: string;
}) {
  return prisma.storefrontMission.create({
    data: {
      goal: params.goal,
      constraintsJson: params.constraints ? JSON.stringify(params.constraints) : null,
      createdByUserId: params.createdByUserId,
      status: "PLANNING",
    },
  });
}

export async function getStorefrontMission(missionId: string) {
  return prisma.storefrontMission.findUnique({
    where: { id: missionId },
    include: { nodes: { orderBy: [{ createdAt: "asc" }, { attempt: "asc" }] }, artifacts: true },
  });
}

export async function listStorefrontMissions(take = 20) {
  return prisma.storefrontMission.findMany({ orderBy: { createdAt: "desc" }, take });
}

export async function setMissionWorldState(missionId: string, worldStateJson: string) {
  await prisma.storefrontMission.update({ where: { id: missionId }, data: { worldStateJson } });
}

export async function setMissionRunning(missionId: string) {
  await prisma.storefrontMission.update({ where: { id: missionId }, data: { status: "RUNNING", startedAt: new Date() } });
}

/**
 * §10 "ADD INSTRUCTION DURING MISSION" (06/09/2026), clôture réelle.
 *
 * Écrit `pendingInstruction` — une SEULE instruction en attente à la fois
 * (une deuxième soumission avant que la première ait été consommée par la
 * boucle ÉCRASE la précédente, jamais empilée silencieusement : l'API route
 * appelante doit refuser d'écraser une instruction non encore consommée,
 * voir /api/ai-lab/missions/[id]/instruction). Jamais appelable par un rôle
 * du graphe lui-même (aucun fichier supervisor/*.ts n'appelle cette fonction
 * — seule la route Owner-gated le fait) : c'est la garantie structurelle
 * "AI self-promotion impossible" appliquée ici aussi — l'IA ne peut jamais
 * s'auto-instruire, seul l'Owner écrit dans ce champ.
 */
export async function submitPendingInstruction(missionId: string, text: string): Promise<void> {
  const mission = await prisma.storefrontMission.findUnique({ where: { id: missionId }, select: { pendingInstruction: true, status: true } });
  if (!mission) throw new Error(`StorefrontMission "${missionId}" introuvable.`);
  if (mission.pendingInstruction) throw new Error("Une instruction est déjà en attente de traitement par la boucle — attendez qu'elle soit consommée avant d'en soumettre une nouvelle.");
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(mission.status)) throw new Error(`Mission déjà dans un état terminal (${mission.status}) — impossible d'ajouter une instruction.`);
  await prisma.storefrontMission.update({ where: { id: missionId }, data: { pendingInstruction: text } });
}

/**
 * Consomme ATOMIQUEMENT l'instruction en attente — lue puis EFFACÉE dans la
 * même transaction, et journalisée dans `instructionsJson` (historique
 * append-only, jamais une réécriture qui perdrait les instructions
 * précédentes). Renvoie `null` si aucune instruction n'attend (cas normal,
 * vérifié à CHAQUE itération de la boucle du graphe).
 */
export async function consumePendingInstruction(missionId: string): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const mission = await tx.storefrontMission.findUnique({ where: { id: missionId }, select: { pendingInstruction: true, instructionsJson: true } });
    if (!mission?.pendingInstruction) return null;
    const text = mission.pendingInstruction;
    const history = mission.instructionsJson ? (JSON.parse(mission.instructionsJson) as Array<{ text: string; addedAt: string }>) : [];
    history.push({ text, addedAt: new Date().toISOString() });
    await tx.storefrontMission.update({ where: { id: missionId }, data: { pendingInstruction: null, instructionsJson: JSON.stringify(history) } });
    return text;
  });
}

/**
 * Ajoute des nodes au graphe — appelable À TOUT MOMENT de la mission
 * (réplanification réelle, §5). `key` est unique par mission (contrainte DB
 * `@@unique([missionId, key])`) : ajouter un node avec une clé déjà connue
 * est un bug de plan, jamais silencieusement ignoré (l'insertion échoue).
 */
export async function addNodes(
  missionId: string,
  nodes: Array<{ key: string; role: string; dependsOn: string[]; input: unknown }>,
) {
  await prisma.storefrontMissionNode.createMany({
    data: nodes.map((n) => ({
      missionId,
      key: n.key,
      role: n.role,
      dependsOnJson: JSON.stringify(n.dependsOn),
      inputJson: JSON.stringify(n.input),
      status: "PENDING",
    })),
  });
}

export interface GraphNodeRow {
  id: string;
  key: string;
  role: string;
  dependsOn: string[];
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  attempt: number;
  /** Objectif/paramètres fournis par le plan au moment d'addNodes() — jamais réécrit après coup (traçabilité). */
  input: { objective?: string } & Record<string, unknown>;
  output: SpecialistOutput | null;
}

export async function listNodes(missionId: string): Promise<GraphNodeRow[]> {
  const rows = await prisma.storefrontMissionNode.findMany({ where: { missionId } });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    role: r.role,
    dependsOn: r.dependsOnJson ? (JSON.parse(r.dependsOnJson) as string[]) : [],
    status: r.status as GraphNodeRow["status"],
    attempt: r.attempt,
    input: r.inputJson ? (JSON.parse(r.inputJson) as GraphNodeRow["input"]) : {},
    output: r.outputJson ? (JSON.parse(r.outputJson) as SpecialistOutput) : null,
  }));
}

/** Réclame UN node PENDING précis pour exécution (jamais deux runners sur le même node — verrou réel). */
export async function claimNode(nodeId: string) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "storefront_mission_nodes"
      WHERE "id" = ${nodeId} AND "status" = 'PENDING'
      FOR UPDATE SKIP LOCKED
    `;
    const claimed = rows[0];
    if (!claimed) return null;
    return tx.storefrontMissionNode.update({
      where: { id: claimed.id },
      data: { status: "RUNNING", startedAt: new Date(), heartbeatAt: new Date() },
    });
  });
}

export async function heartbeatNode(nodeId: string) {
  await prisma.storefrontMissionNode.update({ where: { id: nodeId }, data: { heartbeatAt: new Date() } });
}

export async function succeedNode(params: {
  nodeId: string;
  missionId: string;
  output: SpecialistOutput;
  provider?: string;
  model?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  artifacts?: Array<{ kind: JobArtifactKind; storageRef: string; meta?: Record<string, unknown> }>;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.storefrontMissionNode.update({
      where: { id: params.nodeId },
      data: {
        status: "SUCCEEDED",
        outputJson: JSON.stringify(params.output),
        confidence: params.output.confidence,
        finishedAt: new Date(),
        provider: params.provider ?? null,
        model: params.model ?? null,
        costUsd: params.costUsd ?? null,
        tokensIn: params.tokensIn ?? null,
        tokensOut: params.tokensOut ?? null,
      },
    });
    if (params.artifacts && params.artifacts.length > 0) {
      await tx.storefrontMissionArtifact.createMany({
        data: params.artifacts.map((a) => ({
          missionId: params.missionId,
          nodeId: params.nodeId,
          kind: a.kind,
          storageRef: a.storageRef,
          metaJson: a.meta ? JSON.stringify(a.meta) : null,
        })),
      });
    }
  });
}

export async function failNode(params: { nodeId: string; error: string }) {
  await prisma.storefrontMissionNode.update({
    where: { id: params.nodeId },
    data: { status: "FAILED", finishedAt: new Date(), errorJson: JSON.stringify({ error: params.error }) },
  });
}

/** §11 : PRUNE — marque une branche comme volontairement non poursuivie, jamais supprimée (traçabilité). */
export async function skipNode(params: { nodeId: string; reason: string }) {
  await prisma.storefrontMissionNode.update({
    where: { id: params.nodeId },
    data: { status: "SKIPPED", finishedAt: new Date(), errorJson: JSON.stringify({ skippedReason: params.reason }) },
  });
}

export async function markMissionSucceeded(missionId: string, result: unknown, totalCostUsd: number | null) {
  await prisma.storefrontMission.update({
    where: { id: missionId },
    data: { status: "SUCCEEDED", resultJson: JSON.stringify(result), totalCostUsd, finishedAt: new Date() },
  });
}

export async function markMissionFailed(missionId: string, lastError: string) {
  await prisma.storefrontMission.update({
    where: { id: missionId },
    data: { status: "FAILED", lastError, finishedAt: new Date() },
  });
}

/** §57 Kill Switch foundation : arrêt coopératif distinct d'un échec — jamais confondu avec FAILED (état DB fidèle à la raison réelle de l'arrêt). */
export async function markMissionCancelled(missionId: string) {
  await prisma.storefrontMission.update({
    where: { id: missionId },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
}

/** PHASE 5 (§"Real-Time Controls" — PAUSE/RESUME/CANCEL) : pose le flag coopératif lu par isCancelRequested() ; jamais une coupure forcée. */
export async function requestMissionCancellation(missionId: string): Promise<void> {
  await prisma.storefrontMission.update({ where: { id: missionId }, data: { cancelRequested: true } });
}

/** PHASE 5 (§"Hard Budget"/borne murale Vercel) : arrêt coopératif RÉSUMABLE — distinct de CANCELLED (demandé par l'owner) et de FAILED (erreur réelle). */
export async function markMissionPaused(missionId: string, reason: string): Promise<void> {
  await prisma.storefrontMission.update({
    where: { id: missionId },
    data: { status: "PAUSED", lastError: reason },
  });
}

export async function isCancelRequested(missionId: string): Promise<boolean> {
  const mission = await prisma.storefrontMission.findUnique({ where: { id: missionId }, select: { cancelRequested: true } });
  return mission?.cancelRequested ?? false;
}

export function nodeHeartbeatStale(node: { status: string; heartbeatAt: Date | null; startedAt: Date | null }): boolean {
  if (node.status !== "RUNNING") return false;
  const reference = node.heartbeatAt ?? node.startedAt;
  if (!reference) return true;
  return Date.now() - reference.getTime() > STALE_HEARTBEAT_MS;
}
