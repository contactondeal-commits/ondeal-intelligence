import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@prisma/client";
import { stepHeartbeatStale } from "@/lib/ai/jobs/store";
import { runJobToCompletion } from "@/lib/ai/jobs/worker";
import type { JobStepDefinition } from "@/lib/ai/jobs/types";

/**
 * ONDEAL AI JOB ENGINE — tests de la boucle de référence (06/09/2026).
 *
 * store.ts est mocké par un magasin en mémoire — aucune base réelle
 * (aucun DATABASE_URL dans ce sandbox). Ce que ces tests vérifient n'est
 * pas la couche Prisma elle-même (non testable ici), mais le CONTRAT de
 * runJobToCompletion : reprise, retry borné, annulation coopérative,
 * timeout — exactement les garanties demandées explicitement ("si le
 * worker disparaît, le job doit pouvoir reprendre à la dernière étape
 * valide").
 */

const fake = vi.hoisted(() => ({
  steps: [] as Array<{ id: string; index: number; attempt: number; status: string; output?: unknown; error?: string }>,
  job: { status: "RUNNING", resultJson: null as string | null, lastError: null as string | null, currentStepIndex: 0 },
  cancelRequested: false,
  reset() {
    this.steps = [];
    this.job = { status: "RUNNING", resultJson: null, lastError: null, currentStepIndex: 0 };
    this.cancelRequested = false;
  },
}));

vi.mock("@/lib/ai/jobs/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/jobs/store")>();
  return {
    ...actual, // conserve stepHeartbeatStale (fonction pure, réellement testée, pas mockée)
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
      if (fake.job.currentStepIndex === stepIndex) fake.job.currentStepIndex = stepIndex + 1;
    },
    failStep: async ({ stepId, error }: { stepId: string; error: string }) => {
      const step = fake.steps.find((s) => s.id === stepId);
      if (step) {
        step.status = "FAILED";
        step.error = error;
      }
    },
    getPriorOutputs: async (_jobId: string, currentStepIndex: number) =>
      fake.steps
        .filter((s) => s.status === "SUCCEEDED" && s.index < currentStepIndex)
        .sort((a, b) => a.index - b.index)
        .map((s) => s.output),
    markJobSucceeded: async (_jobId: string, result: unknown) => {
      fake.job.status = "SUCCEEDED";
      fake.job.resultJson = JSON.stringify(result);
    },
    markJobFailed: async (_jobId: string, err: string) => {
      fake.job.status = "FAILED";
      fake.job.lastError = err;
    },
  };
});

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job1",
    storeId: "store1",
    type: "test",
    status: "RUNNING",
    inputJson: JSON.stringify({ start: true }),
    resultJson: null,
    lastError: null,
    currentStepIndex: 0,
    attempt: 0,
    maxAttempts: 3,
    cancelRequested: false,
    createdByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  } as Job;
}

beforeEach(() => {
  fake.reset();
});

describe("stepHeartbeatStale — détection de step abandonné (même principe que RUNNING_GUARD_MS)", () => {
  it("un step RUNNING avec un heartbeat récent n'est jamais considéré périmé", () => {
    expect(stepHeartbeatStale({ status: "RUNNING", heartbeatAt: new Date(), startedAt: new Date() })).toBe(false);
  });

  it("un step RUNNING sans heartbeat depuis plus de 10 minutes est périmé", () => {
    const old = new Date(Date.now() - 11 * 60 * 1000);
    expect(stepHeartbeatStale({ status: "RUNNING", heartbeatAt: old, startedAt: old })).toBe(true);
  });

  it("un step qui n'est pas RUNNING n'est jamais périmé, quelle que soit la date", () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    expect(stepHeartbeatStale({ status: "SUCCEEDED", heartbeatAt: old, startedAt: old })).toBe(false);
  });
});

describe("runJobToCompletion — succès simple", () => {
  it("exécute tous les steps dans l'ordre et retourne le résultat du dernier", async () => {
    const steps: JobStepDefinition[] = [
      { name: "step0", run: async () => ({ output: "a" }) },
      { name: "step1", run: async (ctx) => ({ output: `${ctx.priorOutputs[0]}-b` }) },
    ];
    const outcome = await runJobToCompletion(makeJob(), steps);
    expect(outcome).toEqual({ status: "SUCCEEDED", result: "a-b" });
    expect(fake.job.status).toBe("SUCCEEDED");
    expect(fake.job.currentStepIndex).toBe(2);
  });
});

describe("runJobToCompletion — retry (NO BLIND LOOP : borné, jamais silencieux)", () => {
  it("un step qui échoue une fois puis réussit produit deux tentatives, jamais une réécriture de la première", async () => {
    let calls = 0;
    const steps: JobStepDefinition[] = [
      {
        name: "flaky",
        run: async () => {
          calls += 1;
          if (calls === 1) throw new Error("échec transitoire");
          return { output: "ok" };
        },
      },
    ];
    const outcome = await runJobToCompletion(makeJob(), steps, { maxStepAttempts: 3 });
    expect(outcome).toEqual({ status: "SUCCEEDED", result: "ok" });
    const attemptsForStep0 = fake.steps.filter((s) => s.index === 0);
    expect(attemptsForStep0).toHaveLength(2);
    expect(attemptsForStep0[0]?.status).toBe("FAILED");
    expect(attemptsForStep0[1]?.status).toBe("SUCCEEDED");
  });

  it("un step qui échoue systématiquement abandonne le job après maxStepAttempts, jamais une boucle infinie", async () => {
    const steps: JobStepDefinition[] = [{ name: "always_fails", run: async () => { throw new Error("boom"); } }];
    const outcome = await runJobToCompletion(makeJob(), steps, { maxStepAttempts: 2 });
    expect(outcome.status).toBe("FAILED");
    expect(fake.job.status).toBe("FAILED");
    expect(fake.steps.filter((s) => s.index === 0)).toHaveLength(2); // exactement maxStepAttempts, jamais plus
  });
});

describe("runJobToCompletion — annulation coopérative", () => {
  it("un job dont l'annulation est demandée s'arrête avant le premier step, sans le démarrer", async () => {
    fake.cancelRequested = true;
    const steps: JobStepDefinition[] = [{ name: "should_not_run", run: async () => ({ output: "x" }) }];
    const outcome = await runJobToCompletion(makeJob(), steps);
    expect(outcome).toEqual({ status: "CANCELLED" });
    expect(fake.steps).toHaveLength(0);
  });
});

describe("runJobToCompletion — timeout et reprise (résumabilité)", () => {
  it("un budget de temps déjà dépassé met le job en pause sans exécuter aucun step, et un appel suivant reprend proprement", async () => {
    const steps: JobStepDefinition[] = [{ name: "step0", run: async () => ({ output: "done" }) }];

    const paused = await runJobToCompletion(makeJob(), steps, { maxDurationMs: -1000 });
    expect(paused).toEqual({ status: "PAUSED_TIMEOUT" });
    expect(fake.steps).toHaveLength(0);
    expect(fake.job.currentStepIndex).toBe(0); // rien n'a avancé — la reprise repartira du même point, jamais d'un step sauté

    // Reprise : même job (currentStepIndex inchangé), budget normal cette fois.
    const resumed = await runJobToCompletion(makeJob({ currentStepIndex: fake.job.currentStepIndex }), steps);
    expect(resumed).toEqual({ status: "SUCCEEDED", result: "done" });
  });
});
