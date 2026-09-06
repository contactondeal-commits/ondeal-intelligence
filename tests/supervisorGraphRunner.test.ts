import { beforeEach, describe, expect, it, vi } from "vitest";
import { runStorefrontMission } from "@/lib/ai/supervisor/graphRunner";
import { runMissionToCompletion } from "@/lib/ai/coder/missionRunner";
import type { NodeExecutionResult, SpecialistOutput, WorldState } from "@/lib/ai/supervisor/types";

/**
 * ONDEAL AI CORE — PHASE 4 : tests de la boucle du graphe Supervisor
 * (06/09/2026), §2/§5/§11/§56/§57. Même principe que
 * tests/coderMissionRunner.test.ts : un magasin en mémoire remplace
 * graphStore.ts, aucune base réelle. Le catalogue de spécialistes
 * (catalogue.ts) et l'intégration Coder Agent (missionStore/missionRunner/
 * steps, §28) sont aussi remplacés par des doubles de test — ce fichier
 * teste UNIQUEMENT l'orchestration (résolution de dépendances, PRUNE en
 * cascade, annulation coopérative, agrégation de coût), jamais un vrai
 * appel modèle ni une vraie CoderMission (couvert ailleurs : la mission
 * réelle scriptée, §61-§76, et coderMissionRunner.test.ts pour la boucle
 * Coder Agent elle-même).
 */

function ok(data: unknown = {}): SpecialistOutput {
  return { findings: [], evidence: [], uncertainties: [], recommendations: [], confidence: 0.8, data };
}

const fake = vi.hoisted(() => ({
  nodes: [] as Array<{ id: string; key: string; role: string; dependsOn: string[]; status: string; input: Record<string, unknown>; output: SpecialistOutput | null }>,
  mission: { id: "mission1", goal: "Refonte candidate premium de /login", cancelRequested: false, worldStateJson: null as string | null },
  status: "PLANNING" as string,
  lastError: null as string | null,
  resultJson: null as unknown,
  nextId: 1,
  planResult: {
    nodes: [
      { key: "brand_audit", role: "brand_strategist", dependsOn: [] as string[], objective: "Auditer la marque." },
      { key: "ux_audit", role: "ux_architect", dependsOn: [] as string[], objective: "Auditer l'UX." },
      { key: "cro_audit", role: "cro_strategist", dependsOn: [] as string[], objective: "Auditer la conversion." },
      { key: "a11y_audit", role: "accessibility_reviewer", dependsOn: [] as string[], objective: "Auditer l'accessibilité." },
      { key: "perf_audit", role: "performance_reviewer", dependsOn: [] as string[], objective: "Auditer la performance." },
      { key: "creative_directions", role: "creative_director", dependsOn: ["brand_audit", "ux_audit", "cro_audit", "a11y_audit", "perf_audit"], objective: "Générer des directions créatives." },
      { key: "synthesis", role: "synthesis", dependsOn: ["creative_directions"], objective: "Sélectionner/synthétiser." },
      { key: "implement_candidate", role: "coder_implementation", dependsOn: ["synthesis"], objective: "Implémenter la candidate." },
      { key: "critic", role: "adversarial_critic", dependsOn: ["implement_candidate"], objective: "Critique adversariale." },
      { key: "judge", role: "independent_judge", dependsOn: ["critic"], objective: "Verdict final." },
    ],
  },
  executorImpl: {} as Record<string, (ctx: { getNodeOutput(key: string): SpecialistOutput | undefined }) => Promise<NodeExecutionResult>>,
  // CORRECTIF DE PRODUCTION (06/09/2026, mission réelle
  // "cmtq415440000l204rqiey6j8") : quand défini, le mock de
  // callStructuredSpecialist (planning) lève CETTE erreur au lieu de
  // renvoyer planResult — reproduit exactement la classe de bug réelle
  // (exception non interceptée pendant la planification, avant le premier
  // node persisté).
  planShouldThrowMessage: null as string | null,
  reset() {
    this.nodes = [];
    this.mission = { id: "mission1", goal: "Refonte candidate premium de /login", cancelRequested: false, worldStateJson: null };
    this.status = "PLANNING";
    this.lastError = null;
    this.resultJson = null;
    this.nextId = 1;
    this.planShouldThrowMessage = null;
    this.executorImpl = {
      brand_strategist: async () => ({ output: ok({ note: "brand ok" }) }),
      ux_architect: async () => ({ output: ok({ note: "ux ok" }) }),
      cro_strategist: async () => ({ output: ok({ note: "cro ok" }) }),
      accessibility_reviewer: async () => ({ output: ok({ note: "a11y ok" }) }),
      performance_reviewer: async () => ({ output: ok({ note: "perf ok" }) }),
      creative_director: async () => ({ output: ok({ directions: [{ id: "A", strategy: "s" }] }), costUsd: 0.02 }),
      synthesis: async () => ({ output: ok({ selection: "SINGLE", selectedDirectionId: "A", finalBrief: { strategy: "s", story: "st", hierarchy: "h", visualPhilosophy: "v", commerceReasoning: "c" } }), costUsd: 0.01 }),
      adversarial_critic: async () => ({ output: ok({ verdict: "PASS", blockingIssues: [], weaknesses: [], rejectionCase: "Pourrait manquer de mesure réelle de conversion." }), costUsd: 0.015 }),
      independent_judge: async () => ({ output: ok({ verdict: "READY_FOR_RELEASE", justification: "Preuves suffisantes.", evidenceReviewed: ["diff", "screenshot"] }), costUsd: 0.01 }),
    };
  },
}));
fake.reset();

vi.mock("@/lib/ai/supervisor/graphStore", () => ({
  createStorefrontMission: vi.fn(),
  getStorefrontMission: async (missionId: string) =>
    missionId === fake.mission.id
      ? {
          id: fake.mission.id,
          goal: fake.mission.goal,
          nodes: fake.nodes.map((n) => ({ ...n, attempt: 1, outputJson: n.output ? JSON.stringify(n.output) : null })),
          worldStateJson: fake.mission.worldStateJson,
          totalCostUsd: null,
          autonomyLevel: "ASSIST",
          environment: "SANDBOX",
          hardBudgetUsd: null,
        }
      : null,
  listStorefrontMissions: vi.fn(),
  setMissionWorldState: async (_id: string, json: string) => {
    fake.mission.worldStateJson = json;
  },
  setMissionRunning: async () => {
    fake.status = "RUNNING";
  },
  addNodes: async (_missionId: string, nodes: Array<{ key: string; role: string; dependsOn: string[]; input: unknown }>) => {
    for (const n of nodes) {
      fake.nodes.push({ id: `n${fake.nextId++}`, key: n.key, role: n.role, dependsOn: n.dependsOn, status: "PENDING", input: n.input as Record<string, unknown>, output: null });
    }
  },
  listNodes: async () => fake.nodes.map((n) => ({ ...n, attempt: 1 })),
  claimNode: async (nodeId: string) => {
    const node = fake.nodes.find((n) => n.id === nodeId && n.status === "PENDING");
    if (!node) return null;
    node.status = "RUNNING";
    return { ...node };
  },
  heartbeatNode: async () => {},
  succeedNode: async (params: { nodeId: string; output: SpecialistOutput }) => {
    const node = fake.nodes.find((n) => n.id === params.nodeId);
    if (node) {
      node.status = "SUCCEEDED";
      node.output = params.output;
    }
  },
  failNode: async (params: { nodeId: string; error: string }) => {
    const node = fake.nodes.find((n) => n.id === params.nodeId);
    if (node) node.status = "FAILED";
    void params.error;
  },
  skipNode: async (params: { nodeId: string; reason: string }) => {
    const node = fake.nodes.find((n) => n.id === params.nodeId);
    if (node) node.status = "SKIPPED";
    void params.reason;
  },
  markMissionSucceeded: async (_id: string, result: unknown) => {
    fake.status = "SUCCEEDED";
    fake.resultJson = result;
  },
  markMissionFailed: async (_id: string, err: string) => {
    fake.status = "FAILED";
    fake.lastError = err;
  },
  markMissionCancelled: async () => {
    fake.status = "CANCELLED";
  },
  markMissionPaused: async (_id: string, reason: string) => {
    fake.status = "PAUSED";
    fake.lastError = reason;
  },
  isCancelRequested: async () => fake.mission.cancelRequested,
  nodeHeartbeatStale: () => false,
  // §10 "ADD INSTRUCTION DURING MISSION" (06/09/2026) : jamais d'instruction
  // en attente dans ces tests (aucun test de ce fichier n'exerce ce chemin
  // — voir supervisorInstruction.test.ts pour la couverture dédiée).
  consumePendingInstruction: async () => null,
  submitPendingInstruction: vi.fn(),
}));

// PHASE 5 : Policy Engine/Audit mockés (toujours ALLOW_AUTO/no-op ici) — ce
// fichier teste UNIQUEMENT l'orchestration du graphe (voir en-tête), pas le
// Policy Engine lui-même (couvert par un futur policyEngine.test.ts dédié).
vi.mock("@/lib/ai/policy/engine", () => ({
  evaluatePolicy: async () => ({ decision: "ALLOW_AUTO" as const, reason: "test — toujours autorisé" }),
}));
vi.mock("@/lib/ai/policy/audit", () => ({
  appendAuditLog: async () => {},
}));

vi.mock("@/lib/ai/supervisor/worldState", () => ({
  buildWorldState: async (): Promise<WorldState> => ({ builtAt: new Date().toISOString(), facts: [] }),
}));

vi.mock("@/lib/ai/supervisor/catalogue", () => ({
  buildCatalogue: () => ({
    brandStrategist: (ctx: unknown) => fake.executorImpl.brand_strategist!(ctx as never),
    uxArchitect: (ctx: unknown) => fake.executorImpl.ux_architect!(ctx as never),
    croStrategist: (ctx: unknown) => fake.executorImpl.cro_strategist!(ctx as never),
    accessibilityReviewer: (ctx: unknown) => fake.executorImpl.accessibility_reviewer!(ctx as never),
    performanceReviewer: (ctx: unknown) => fake.executorImpl.performance_reviewer!(ctx as never),
    creativeDirector: (ctx: unknown) => fake.executorImpl.creative_director!(ctx as never),
    synthesis: (ctx: unknown) => fake.executorImpl.synthesis!(ctx as never),
    adversarialCritic: (ctx: unknown) => fake.executorImpl.adversarial_critic!(ctx as never),
    independentJudge: (ctx: unknown) => fake.executorImpl.independent_judge!(ctx as never),
  }),
}));

vi.mock("@/lib/ai/supervisor/specialists", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/supervisor/specialists")>();
  return {
    ...actual,
    callStructuredSpecialist: async () => {
      if (fake.planShouldThrowMessage) {
        throw new Error(fake.planShouldThrowMessage);
      }
      return {
        output: ok(fake.planResult),
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        costUsd: 0.005,
        tokensIn: 500,
        tokensOut: 300,
      };
    },
  };
});

vi.mock("@/lib/ai/coder/missionStore", () => ({
  createMission: async () => ({ id: "cm1" }),
  claimMissionById: async () => ({ id: "cm1" }),
  getMission: async () => ({
    id: "cm1",
    steps: [
      { name: "diff", status: "SUCCEEDED", outputJson: JSON.stringify({ diffText: "diff --git a/src/app/login/page.tsx" }), provider: null, model: null, costUsd: null },
      {
        name: "verify_and_fix",
        status: "SUCCEEDED",
        outputJson: JSON.stringify({ success: true, iterations: [{ attempt: 1, ok: true }], criticReport: { overallPass: true, issues: [] }, editedFiles: ["src/app/login/page.tsx"] }),
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        costUsd: 0.03,
      },
    ],
  }),
}));

vi.mock("@/lib/ai/coder/missionRunner", () => ({
  runMissionToCompletion: vi.fn().mockResolvedValue({ status: "SUCCEEDED", result: { success: true } }),
}));

vi.mock("@/lib/ai/coder/steps", () => ({
  buildCoderMissionSteps: () => [],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    coderMissionArtifact: { findMany: vi.fn().mockResolvedValue([{ id: "a1", missionId: "cm1", stepId: "s1", kind: "SCREENSHOT", storageRef: "/tmp/shot.png", metaJson: null, createdAt: new Date() }]) },
    aiLabAttachment: { findMany: vi.fn().mockResolvedValue([]) },
    // §14/§15 "Owner Agent Control" (06/09/2026) : listDisabledRoles() lu à
    // chaque itération de la boucle — vide par défaut ici (aucun rôle
    // désactivé dans ces tests, comportement identique à avant son ajout).
    agentRoleConfig: { findMany: vi.fn().mockResolvedValue([]) },
    // §57-60 "Persistent Memory" (06/09/2026) : recentFailureNotes/
    // recentSuccessNotes (planning) et writeMemory (échec de node/succès de
    // mission) sont maintenant appelés par le runner réel — vides par
    // défaut ici (aucune mémoire pré-existante dans ces tests).
    memoryRecord: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
  },
}));

const baseDeps = {
  provider: { name: "anthropic", capabilities: () => null, generate: vi.fn() },
  sourceRepoRoot: "/tmp/fake-repo",
  createdByUserId: "platform-owner-1",
  coderSecurity: { allowedPathPrefixes: ["src/app/login"], maxCostUsd: 5, maxFixIterations: 2, operationTimeoutMs: 60_000 },
  coderPreviewPort: 4500,
};

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
});

describe("runStorefrontMission — chemin heureux complet", () => {
  it("exécute tout le graphe (5 analyses en parallèle → créatif → synthèse → implémentation Coder Agent → critic → judge) et se termine SUCCEEDED", async () => {
    const outcome = await runStorefrontMission("mission1", baseDeps);
    expect(outcome.status).toBe("SUCCEEDED");
    expect(fake.status).toBe("SUCCEEDED");
    const allSucceeded = fake.nodes.every((n) => n.status === "SUCCEEDED");
    expect(allSucceeded).toBe(true);
    expect(fake.nodes.map((n) => n.key)).toEqual(["brand_audit", "ux_audit", "cro_audit", "a11y_audit", "perf_audit", "creative_directions", "synthesis", "implement_candidate", "critic", "judge"]);
    if (outcome.status === "SUCCEEDED") {
      // coût agrégé = planning (0.005) + créatif (0.02) + synthèse (0.01) + implémentation (0.03, somme des steps CoderMission) + critic (0.015) + judge (0.01)
      expect(outcome.totalCostUsd).toBeCloseTo(0.005 + 0.02 + 0.01 + 0.03 + 0.015 + 0.01, 6);
    }
  });

  it("délègue réellement le node coder_implementation à une VRAIE CoderMission (createMission + runMissionToCompletion), jamais une réimplémentation", async () => {
    await runStorefrontMission("mission1", baseDeps);
    expect(runMissionToCompletion).toHaveBeenCalledTimes(1);
    const implementNode = fake.nodes.find((n) => n.key === "implement_candidate");
    expect((implementNode?.output?.data as { coderMissionId?: string })?.coderMissionId).toBe("cm1");
  });
});

describe("runStorefrontMission — PRUNE en cascade (§11)", () => {
  it("un analyste qui échoue fait SKIPPER toute la branche en aval, jamais un deadlock silencieux", async () => {
    fake.executorImpl.brand_strategist = async () => {
      throw new Error("Panne modèle simulée pour ce test.");
    };
    const outcome = await runStorefrontMission("mission1", baseDeps);
    expect(outcome.status).toBe("FAILED");
    const byKey = new Map(fake.nodes.map((n) => [n.key, n.status]));
    expect(byKey.get("brand_audit")).toBe("FAILED");
    expect(byKey.get("ux_audit")).toBe("SUCCEEDED"); // indépendant — pas affecté
    expect(byKey.get("creative_directions")).toBe("SKIPPED"); // dépend de brand_audit (FAILED)
    expect(byKey.get("synthesis")).toBe("SKIPPED");
    expect(byKey.get("implement_candidate")).toBe("SKIPPED");
    expect(byKey.get("critic")).toBe("SKIPPED");
    expect(byKey.get("judge")).toBe("SKIPPED");
    expect(runMissionToCompletion).not.toHaveBeenCalled(); // jamais atteint une fois la branche prunée
  });
});

describe("runStorefrontMission — annulation coopérative (§57 Kill Switch foundation)", () => {
  it("une mission dont l'annulation est demandée AVANT le premier tour s'arrête sans exécuter aucun node", async () => {
    fake.mission.cancelRequested = true;
    const outcome = await runStorefrontMission("mission1", baseDeps);
    expect(outcome.status).toBe("CANCELLED");
    expect(fake.status).toBe("CANCELLED");
    expect(fake.nodes.every((n) => n.status === "PENDING")).toBe(true);
  });
});

describe("runStorefrontMission — rôle de plan inconnu (§85 : bug de plan, jamais un skip muet)", () => {
  it("échoue explicitement si le plan référence un rôle sans exécuteur", async () => {
    fake.planResult = { nodes: [{ key: "mystere", role: "role_qui_n_existe_pas", dependsOn: [], objective: "x" }] };
    const outcome = await runStorefrontMission("mission1", baseDeps);
    expect(outcome.status).toBe("FAILED");
    const node = fake.nodes.find((n) => n.key === "mystere");
    expect(node?.status).toBe("FAILED");
  });
});

/**
 * RÉGRESSION — BUG DE PRODUCTION RÉEL (06/09/2026, mission
 * "cmtq415440000l204rqiey6j8", premier vrai test Owner en production).
 *
 * Symptôme original observé par l'Owner : MISSION_CREATE + MISSION_RUN_STARTED
 * présents dans l'Audit, puis PLUS RIEN — la mission restait bloquée en
 * PLANNING/EN DIRECT avec "Graphe (0 nodes)" et coût "—", et le Composer
 * affichait un simple "Erreur HTTP 500" opaque. Root cause confirmée : le
 * prompt système du planner (planInitialGraph) demandait une réponse JSON
 * "nue" ({"nodes":[...]} à la racine) alors que callStructuredSpecialist
 * exige INCONDITIONNELLEMENT l'enveloppe complète — une exception levée à
 * CE stade (avant setMissionRunning/addNodes, donc avant que la mission ne
 * quitte son statut de création PLANNING et avant qu'aucun node ne soit
 * persisté) se propageait NON INTERCEPTÉE jusqu'à la route API (aucun
 * try/catch), produisant exactement ce symptôme.
 *
 * Ce test ne dépend PAS de la cause précise (le prompt est corrigé par
 * ailleurs) — il simule N'IMPORTE QUELLE exception fatale pendant la
 * planification (§"defense in depth" du correctif : callStructuredSpecialist
 * lève, comme le ferait une vraie non-conformité JSON, une panne provider,
 * ou tout autre échec futur non encore identifié) et verrouille le
 * comportement EXIGÉ par l'Owner : jamais un statut PLANNING/RUNNING
 * fantôme — TOUJOURS un FAILED honnête avec une cause exploitable.
 */
describe("runStorefrontMission — une exception fatale pendant la planification ne doit JAMAIS laisser la mission bloquée (régression production 06/09/2026)", () => {
  it("bascule la mission en FAILED avec la cause réelle persistée, jamais un throw non intercepté ni un statut PLANNING fantôme", async () => {
    fake.planShouldThrowMessage = "Sortie spécialiste non conforme à l'enveloppe attendue (findings/evidence/uncertainties/recommendations/confidence/data) : simulation de test.";

    // §"jamais un throw non intercepté" : l'appel ne doit JAMAIS rejeter —
    // runStorefrontMission doit TOUJOURS résoudre vers un GraphRunnerOutcome,
    // exactement comme le fait déjà le chemin "deadlock"/"rôle inconnu".
    const outcome = await runStorefrontMission("mission1", baseDeps);

    expect(outcome.status).toBe("FAILED");
    if (outcome.status === "FAILED") {
      expect(outcome.reason).toContain("simulation de test");
    }

    // La mission doit avoir RÉELLEMENT basculé en FAILED (markMissionFailed
    // appelé avec la cause réelle) — jamais restée sur son statut de
    // création "PLANNING" (le symptôme exact rapporté par l'Owner).
    expect(fake.status).toBe("FAILED");
    expect(fake.status).not.toBe("PLANNING");
    expect(fake.lastError).toContain("simulation de test");

    // Aucun node n'a pu être persisté (addNodes n'est atteint qu'APRÈS un
    // planInitialGraph réussi) — cohérent avec "Graphe (0 nodes)" observé
    // en production, mais désormais accompagné d'un FAILED honnête plutôt
    // que d'un blocage silencieux.
    expect(fake.nodes.length).toBe(0);
  });

  it("ne jette jamais l'exception vers l'appelant (contrat GraphRunnerOutcome respecté même en cas d'erreur totalement inattendue)", async () => {
    fake.planShouldThrowMessage = "Panne totalement inattendue simulée (ex. future régression non encore identifiée).";
    await expect(runStorefrontMission("mission1", baseDeps)).resolves.toMatchObject({ status: "FAILED", missionId: "mission1" });
  });
});
