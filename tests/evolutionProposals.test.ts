import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — §61-65 "System Evolution Console" (06/09/2026).
 *
 * Verrouille, dans l'esprit "no partial theater" (§82) et "AI self-promotion
 * impossible" (§"Owner Sovereignty") :
 *   - detectSignals() ne retourne un signal que sur un VRAI motif mécanique
 *     (seuil réel franchi), jamais un signal inventé pour paraître actif.
 *   - launchProposalMission crée une VRAIE CoderMission (même moteur que
 *     /api/coder-missions) — jamais un exécuteur parallèle.
 *   - Le statut avance MISSION_LAUNCHED → AWAITING_OWNER_REVIEW uniquement
 *     quand la mission liée est RÉELLEMENT terminale (lu à chaque accès,
 *     jamais mis en cache).
 *   - reviewProposal refuse d'APPROUVER une mission qui n'a pas réussi —
 *     jamais un "ship" sur un correctif connu pour échouer.
 *   - shipProposal refuse tout sauf depuis APPROVED — l'IA elle-même ne peut
 *     jamais franchir ces étapes (aucun appel à ces fonctions depuis
 *     supervisor/*.ts, vérifié par grep dans le rapport de session).
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

interface ProposalRow {
  id: string;
  source: string;
  hypothesis: string;
  targetArea: string;
  status: string;
  coderMissionId: string | null;
  reviewedByUserId: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  shippedPrUrl: string | null;
  shippedBranch: string | null;
  shippedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakeDb() {
  const store = new Map<string, ProposalRow>();
  let seq = 0;
  const evolutionProposal = {
    create: vi.fn(async ({ data }: { data: Partial<ProposalRow> }) => {
      const row: ProposalRow = {
        id: `p${++seq}`,
        source: data.source ?? "OWNER",
        hypothesis: data.hypothesis ?? "",
        targetArea: data.targetArea ?? "",
        status: data.status ?? "PROPOSED",
        coderMissionId: data.coderMissionId ?? null,
        reviewedByUserId: null,
        reviewNote: null,
        reviewedAt: null,
        shippedPrUrl: null,
        shippedBranch: null,
        shippedAt: null,
        createdByUserId: data.createdByUserId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(row.id, row);
      return { ...row };
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (store.has(where.id) ? { ...store.get(where.id)! } : null)),
    findFirst: vi.fn(async ({ where }: { where: { targetArea: string; status: { not: string } } }) => {
      for (const row of store.values()) {
        if (row.targetArea === where.targetArea && row.status !== where.status.not) return { ...row };
      }
      return null;
    }),
    findMany: vi.fn(async ({ take }: { take?: number } = {}) => {
      const all = [...store.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return (take ? all.slice(0, take) : all).map((r) => ({ ...r }));
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ProposalRow> }) => {
      const existing = store.get(where.id);
      if (!existing) throw new Error("not found");
      const updated = { ...existing, ...data, updatedAt: new Date() };
      store.set(where.id, updated);
      return { ...updated };
    }),
  };
  return { evolutionProposal, store };
}

async function loadProposals(opts: {
  listAgentRegistry?: ReturnType<typeof vi.fn>;
  createMission?: ReturnType<typeof vi.fn>;
  getMission?: ReturnType<typeof vi.fn>;
  shipMissionAsPullRequest?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.resetModules();
  const fakeDb = makeFakeDb();
  vi.doMock("@/lib/db", () => ({ prisma: { evolutionProposal: fakeDb.evolutionProposal } }));
  vi.doMock("@/lib/ai/agents/registry", () => ({ listAgentRegistry: opts.listAgentRegistry ?? vi.fn().mockResolvedValue([]) }));
  vi.doMock("@/lib/ai/coder/missionStore", () => ({
    createMission: opts.createMission ?? vi.fn().mockResolvedValue({ id: "cm1", goal: "g", status: "QUEUED" }),
    getMission: opts.getMission ?? vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("@/lib/ai/evolution/ship", () => ({
    shipMissionAsPullRequest: opts.shipMissionAsPullRequest ?? vi.fn().mockResolvedValue({ branch: "b", prUrl: "https://x/pr/1", prNumber: 1, changedFiles: [] }),
  }));
  const mod = await import("@/lib/ai/evolution/proposals");
  return { ...mod, fakeDb };
}

describe("detectSignals — signal MÉCANIQUE, jamais inventé", () => {
  it("retourne un signal uniquement pour un rôle sous le seuil ET avec un échantillon suffisant", async () => {
    const listAgentRegistry = vi.fn().mockResolvedValue([
      { role: "adversarial_critic", enabled: true, missionCount: 5, successCount: 1, failureCount: 4, successRate: 0.2, avgCostUsd: null, avgLatencyMs: null, modelsUsed: [] },
      { role: "researcher", enabled: true, missionCount: 10, successCount: 9, failureCount: 1, successRate: 0.9, avgCostUsd: null, avgLatencyMs: null, modelsUsed: [] },
      { role: "data_analyst", enabled: true, missionCount: 1, successCount: 0, failureCount: 1, successRate: 0, avgCostUsd: null, avgLatencyMs: null, modelsUsed: [] }, // échantillon trop faible (1 < seuil) — jamais un signal sur un seul échec
    ]);
    const { detectSignals } = await loadProposals({ listAgentRegistry });
    const signals = await detectSignals();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.targetArea).toContain("adversarial_critic");
    expect(signals[0]?.hypothesis).toMatch(/20%/);
  });

  it("retourne [] quand aucun rôle ne franchit le seuil — jamais un signal fabriqué pour paraître actif", async () => {
    const listAgentRegistry = vi.fn().mockResolvedValue([
      { role: "researcher", enabled: true, missionCount: 10, successCount: 9, failureCount: 1, successRate: 0.9, avgCostUsd: null, avgLatencyMs: null, modelsUsed: [] },
    ]);
    const { detectSignals } = await loadProposals({ listAgentRegistry });
    expect(await detectSignals()).toEqual([]);
  });
});

describe("detectAndPersistSignals — jamais de doublon sur un signal déjà ouvert", () => {
  it("crée une proposition la première fois, la retrouve la seconde (jamais dupliquée)", async () => {
    const listAgentRegistry = vi.fn().mockResolvedValue([
      { role: "adversarial_critic", enabled: true, missionCount: 5, successCount: 1, failureCount: 4, successRate: 0.2, avgCostUsd: null, avgLatencyMs: null, modelsUsed: [] },
    ]);
    const { detectAndPersistSignals } = await loadProposals({ listAgentRegistry });
    const first = await detectAndPersistSignals();
    expect(first).toEqual({ created: 1, skippedExisting: 0 });
    const second = await detectAndPersistSignals();
    expect(second).toEqual({ created: 0, skippedExisting: 1 });
  });
});

describe("launchProposalMission — VRAIE CoderMission, même moteur que /api/coder-missions", () => {
  it("crée la mission, lie coderMissionId, passe le statut à MISSION_LAUNCHED", async () => {
    const createMission = vi.fn().mockResolvedValue({ id: "cm-42", goal: "g", status: "QUEUED" });
    const { createOwnerProposal, launchProposalMission } = await loadProposals({ createMission });
    const proposal = await createOwnerProposal({ hypothesis: "Corrige X", targetArea: "supervisor", userId: "owner1" });

    const { proposal: updated, mission } = await launchProposalMission(proposal.id, "owner1");
    expect(mission.id).toBe("cm-42");
    expect(updated.status).toBe("MISSION_LAUNCHED");
    expect(updated.coderMissionId).toBe("cm-42");
    expect(createMission).toHaveBeenCalledWith({ goal: expect.stringContaining("Corrige X"), createdByUserId: "owner1" });
  });

  it("refuse de relancer une mission pour une proposition qui n'est plus PROPOSED", async () => {
    const { createOwnerProposal, launchProposalMission } = await loadProposals({});
    const proposal = await createOwnerProposal({ hypothesis: "h", targetArea: "t", userId: "owner1" });
    await launchProposalMission(proposal.id, "owner1");
    await expect(launchProposalMission(proposal.id, "owner1")).rejects.toThrow(/MISSION_LAUNCHED/);
  });
});

describe("getProposal/listProposals — synchronisation RÉELLE du statut depuis la CoderMission liée", () => {
  it("fait avancer MISSION_LAUNCHED → AWAITING_OWNER_REVIEW quand la mission liée a réussi", async () => {
    const getMission = vi.fn().mockResolvedValue({ id: "cm1", status: "SUCCEEDED" });
    const { createOwnerProposal, launchProposalMission, getProposal } = await loadProposals({ getMission });
    const proposal = await createOwnerProposal({ hypothesis: "h", targetArea: "t", userId: "owner1" });
    await launchProposalMission(proposal.id, "owner1");

    const synced = await getProposal(proposal.id);
    expect(synced?.status).toBe("AWAITING_OWNER_REVIEW");
    expect(synced?.coderMission?.status).toBe("SUCCEEDED");
  });

  it("reste MISSION_LAUNCHED tant que la mission liée n'est pas terminale", async () => {
    const getMission = vi.fn().mockResolvedValue({ id: "cm1", status: "RUNNING" });
    const { createOwnerProposal, launchProposalMission, getProposal } = await loadProposals({ getMission });
    const proposal = await createOwnerProposal({ hypothesis: "h", targetArea: "t", userId: "owner1" });
    await launchProposalMission(proposal.id, "owner1");

    const synced = await getProposal(proposal.id);
    expect(synced?.status).toBe("MISSION_LAUNCHED");
  });

  it("fait aussi avancer une mission ÉCHOUÉE (FAILED) — l'échec est une information réelle, jamais masquée", async () => {
    const getMission = vi.fn().mockResolvedValue({ id: "cm1", status: "FAILED" });
    const { createOwnerProposal, launchProposalMission, getProposal } = await loadProposals({ getMission });
    const proposal = await createOwnerProposal({ hypothesis: "h", targetArea: "t", userId: "owner1" });
    await launchProposalMission(proposal.id, "owner1");

    const synced = await getProposal(proposal.id);
    expect(synced?.status).toBe("AWAITING_OWNER_REVIEW");
    expect(synced?.coderMission?.status).toBe("FAILED");
  });
});

describe("reviewProposal — décision Owner uniquement, jamais l'IA elle-même", () => {
  it("refuse d'APPROUVER quand la mission liée n'a pas réussi (FAILED)", async () => {
    const getMission = vi.fn().mockResolvedValue({ id: "cm1", status: "FAILED" });
    const { createOwnerProposal, launchProposalMission, reviewProposal } = await loadProposals({ getMission });
    const proposal = await createOwnerProposal({ hypothesis: "h", targetArea: "t", userId: "owner1" });
    await launchProposalMission(proposal.id, "owner1");

    await expect(reviewProposal({ proposalId: proposal.id, userId: "owner1", decision: "APPROVE" })).rejects.toThrow(/n'a PAS réussi/);
  });

  it("autorise REJECT même quand la mission a échoué", async () => {
    const getMission = vi.fn().mockResolvedValue({ id: "cm1", status: "FAILED" });
    const { createOwnerProposal, launchProposalMission, reviewProposal } = await loadProposals({ getMission });
    const proposal = await createOwnerProposal({ hypothesis: "h", targetArea: "t", userId: "owner1" });
    await launchProposalMission(proposal.id, "owner1");

    const reviewed = await reviewProposal({ proposalId: proposal.id, userId: "owner1", decision: "REJECT", note: "pas utile" });
    expect(reviewed.status).toBe("REJECTED");
    expect(reviewed.reviewNote).toBe("pas utile");
  });

  it("autorise APPROVE quand la mission a réussi", async () => {
    const getMission = vi.fn().mockResolvedValue({ id: "cm1", status: "SUCCEEDED" });
    const { createOwnerProposal, launchProposalMission, reviewProposal } = await loadProposals({ getMission });
    const proposal = await createOwnerProposal({ hypothesis: "h", targetArea: "t", userId: "owner1" });
    await launchProposalMission(proposal.id, "owner1");

    const reviewed = await reviewProposal({ proposalId: proposal.id, userId: "owner1", decision: "APPROVE" });
    expect(reviewed.status).toBe("APPROVED");
  });

  it("refuse une revue sur une proposition pas encore AWAITING_OWNER_REVIEW (ex. mission encore MISSION_LAUNCHED)", async () => {
    const getMission = vi.fn().mockResolvedValue({ id: "cm1", status: "RUNNING" });
    const { createOwnerProposal, launchProposalMission, reviewProposal } = await loadProposals({ getMission });
    const proposal = await createOwnerProposal({ hypothesis: "h", targetArea: "t", userId: "owner1" });
    await launchProposalMission(proposal.id, "owner1");

    await expect(reviewProposal({ proposalId: proposal.id, userId: "owner1", decision: "APPROVE" })).rejects.toThrow(/AWAITING_OWNER_REVIEW/);
  });
});

describe("shipProposal — unique écriture externe, uniquement depuis APPROVED", () => {
  it("refuse de livrer une proposition qui n'est pas APPROVED", async () => {
    const { createOwnerProposal, shipProposal } = await loadProposals({});
    const proposal = await createOwnerProposal({ hypothesis: "h", targetArea: "t", userId: "owner1" });
    await expect(shipProposal({ proposalId: proposal.id, userId: "owner1" })).rejects.toThrow(/PROPOSED/);
  });

  it("livre réellement (appelle shipMissionAsPullRequest avec la branche/le titre attendus) et marque SHIPPED", async () => {
    const getMission = vi.fn().mockResolvedValue({ id: "cm1", status: "SUCCEEDED" });
    const shipMissionAsPullRequest = vi.fn().mockResolvedValue({ branch: "system-evolution/pX", prUrl: "https://github.com/x/y/pull/7", prNumber: 7, changedFiles: [{ path: "a.ts", status: "M" }] });
    const { createOwnerProposal, launchProposalMission, reviewProposal, shipProposal } = await loadProposals({ getMission, shipMissionAsPullRequest });
    const proposal = await createOwnerProposal({ hypothesis: "Corrige le rôle X", targetArea: "supervisor", userId: "owner1" });
    await launchProposalMission(proposal.id, "owner1");
    await reviewProposal({ proposalId: proposal.id, userId: "owner1", decision: "APPROVE" });

    const { proposal: shipped, ship } = await shipProposal({ proposalId: proposal.id, userId: "owner1" });
    expect(ship.prUrl).toBe("https://github.com/x/y/pull/7");
    expect((shipped as { status: string }).status).toBe("SHIPPED");
    expect((shipped as { shippedPrUrl: string }).shippedPrUrl).toBe("https://github.com/x/y/pull/7");
    expect(shipMissionAsPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: "cm1", branchName: expect.stringContaining(proposal.id), title: expect.stringContaining("supervisor") }),
    );
  });
});
