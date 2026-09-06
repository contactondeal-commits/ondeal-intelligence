import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoderMission } from "@prisma/client";
import { runMissionToCompletion } from "@/lib/ai/coder/missionRunner";
import type { MissionStepDefinition } from "@/lib/ai/coder/types";

/**
 * ONDEAL AI CORE — PHASE 3 : tests de la boucle de mission (06/09/2026).
 *
 * Même principe que tests/jobs.test.ts (missionRunner.ts est
 * structurellement identique à jobs/worker.ts — §5 réutilisation) : un
 * magasin en mémoire remplace missionStore.ts, aucune base réelle.
 * Vérifie les MÊMES garanties : reprise, retry borné, annulation
 * coopérative, timeout — appliquées à CoderMission plutôt que Job.
 */

const fake = vi.hoisted(() => ({
  steps: [] as Array<{ id: string; index: number; attempt: number; status: string; output?: unknown; error?: string }>,
  mission: { status: "RUNNING", resultJson: null as string | null, lastError: null as string | null, currentStepIndex: 0 },
  cancelRequested: false,
  reset() {
    this.steps = [];
    this.mission = { status: "RUNNING", resultJson: null, lastError: null, currentStepIndex: 0 };
    this.cancelRequested = false;
  },
}));

vi.mock("@/lib/ai/coder/missionStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/coder/missionStore")>();
  return {
    ...actual,
    startStepAttempt: async ({ index, attempt }: { index: number; attempt: number }) => {
      const id = `${index}-${attempt}`;
      fake.steps.push({ id, index, attempt, status: "RUNNING" });
      return { id };
    },
    heartbeatStep: async () => {},
    isCancelRequested: async () => fake.cancelRequested,
    succeedStep: async ({ stepId, stepIndex, output }: { stepId: string; stepIndex: number; output: unknown }) => {
      const step = fake.steps.find((s) => s.id === stepId);
      if (step) {
        step.status = "SUCCEEDED";
        step.output = output;
      }
      if (fake.mission.currentStepIndex === stepIndex) fake.mission.currentStepIndex = stepIndex + 1;
    },
    failStep: async ({ stepId, error }: { stepId: string; error: string }) => {
      const step = fake.steps.find((s) => s.id === stepId);
      if (step) {
        step.status = "FAILED";
        step.error = error;
      }
    },
    getPriorOutputs: async (_missionId: string, currentStepIndex: number) =>
      fake.steps
        .filter((s) => s.status === "SUCCEEDED" && s.index < currentStepIndex)
        .sort((a, b) => a.index - b.index)
        .map((s) => s.output),
    markMissionSucceeded: async (_missionId: string, result: unknown) => {
      fake.mission.status = "SUCCEEDED";
      fake.mission.resultJson = JSON.stringify(result);
    },
    markMissionFailed: async (_missionId: string, err: string) => {
      fake.mission.status = "FAILED";
      fake.mission.lastError = err;
    },
  };
});

function makeMission(overrides: Partial<CoderMission> = {}): CoderMission {
  return {
    id: "mission1",
    goal: "petite amélioration visuelle réversible",
    status: "RUNNING",
    currentStepIndex: 0,
    attempt: 0,
    maxAttempts: 3,
    cancelRequested: false,
    createdByUserId: "platform-owner-1",
    resultJson: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  } as CoderMission;
}

beforeEach(() => {
  fake.reset();
});

describe("runMissionToCompletion — succès simple", () => {
  it("exécute tous les steps dans l'ordre, propage goal au premier step", async () => {
    const steps: MissionStepDefinition[] = [
      { name: "inspect", run: async (ctx) => ({ output: { goal: (ctx.input as { goal: string }).goal } }) },
      { name: "verify_and_fix", run: async (ctx) => ({ output: `verified:${(ctx.priorOutputs[0] as { goal: string }).goal}` }) },
    ];
    const outcome = await runMissionToCompletion(makeMission(), steps);
    expect(outcome).toEqual({ status: "SUCCEEDED", result: "verified:petite amélioration visuelle réversible" });
    expect(fake.mission.status).toBe("SUCCEEDED");
    expect(fake.mission.currentStepIndex).toBe(2);
  });
});

describe("runMissionToCompletion — retry borné (NO BLIND LOOP)", () => {
  it("un step qui échoue puis réussit produit deux tentatives, jamais une réécriture", async () => {
    let calls = 0;
    const steps: MissionStepDefinition[] = [
      {
        name: "flaky_fix",
        run: async () => {
          calls += 1;
          if (calls === 1) throw new Error("build a échoué une première fois");
          return { output: "ok" };
        },
      },
    ];
    const outcome = await runMissionToCompletion(makeMission(), steps, { maxStepAttempts: 3 });
    expect(outcome).toEqual({ status: "SUCCEEDED", result: "ok" });
    const attempts = fake.steps.filter((s) => s.index === 0);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.status).toBe("FAILED");
    expect(attempts[1]?.status).toBe("SUCCEEDED");
  });

  it("un step qui échoue systématiquement abandonne la mission après maxStepAttempts", async () => {
    const steps: MissionStepDefinition[] = [{ name: "verify_and_fix", run: async () => { throw new Error("échec persistant après correction bornée"); } }];
    const outcome = await runMissionToCompletion(makeMission(), steps, { maxStepAttempts: 2 });
    expect(outcome.status).toBe("FAILED");
    expect(fake.mission.status).toBe("FAILED");
    expect(fake.steps.filter((s) => s.index === 0)).toHaveLength(2);
  });
});

describe("runMissionToCompletion — annulation coopérative", () => {
  it("une mission dont l'annulation est demandée s'arrête sans démarrer le premier step", async () => {
    fake.cancelRequested = true;
    const steps: MissionStepDefinition[] = [{ name: "should_not_run", run: async () => ({ output: "x" }) }];
    const outcome = await runMissionToCompletion(makeMission(), steps);
    expect(outcome).toEqual({ status: "CANCELLED" });
    expect(fake.steps).toHaveLength(0);
  });
});

describe("runMissionToCompletion — timeout et reprise", () => {
  it("un budget déjà dépassé met la mission en pause sans exécuter de step, et la reprise repart du même point", async () => {
    const steps: MissionStepDefinition[] = [{ name: "inspect", run: async () => ({ output: "done" }) }];

    const paused = await runMissionToCompletion(makeMission(), steps, { maxDurationMs: -1000 });
    expect(paused).toEqual({ status: "PAUSED_TIMEOUT" });
    expect(fake.steps).toHaveLength(0);
    expect(fake.mission.currentStepIndex).toBe(0);

    const resumed = await runMissionToCompletion(makeMission({ currentStepIndex: fake.mission.currentStepIndex }), steps);
    expect(resumed).toEqual({ status: "SUCCEEDED", result: "done" });
  });
});
