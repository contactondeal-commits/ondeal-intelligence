import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — §10 "ADD INSTRUCTION DURING MISSION" (06/09/2026),
 * clôture réelle. Teste UNIQUEMENT la couche DB (submitPendingInstruction /
 * consumePendingInstruction, graphStore.ts) avec un prisma en mémoire —
 * jamais l'orchestration complète du graphe (déjà couverte, sans ce chemin,
 * par tests/supervisorGraphRunner.test.ts).
 */

const fakeMission = vi.hoisted(() => ({
  row: { id: "m1", pendingInstruction: null as string | null, instructionsJson: null as string | null, status: "RUNNING" as string },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    storefrontMission: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === fakeMission.row.id ? { ...fakeMission.row } : null)),
      update: vi.fn(async ({ data }: { data: Partial<typeof fakeMission.row> }) => {
        Object.assign(fakeMission.row, data);
        return { ...fakeMission.row };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        storefrontMission: {
          findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === fakeMission.row.id ? { ...fakeMission.row } : null)),
          update: vi.fn(async ({ data }: { data: Partial<typeof fakeMission.row> }) => {
            Object.assign(fakeMission.row, data);
            return { ...fakeMission.row };
          }),
        },
      }),
    ),
  },
}));

import { consumePendingInstruction, submitPendingInstruction } from "@/lib/ai/supervisor/graphStore";

beforeEach(() => {
  fakeMission.row = { id: "m1", pendingInstruction: null, instructionsJson: null, status: "RUNNING" };
});

describe("submitPendingInstruction / consumePendingInstruction (§10)", () => {
  it("écrit pendingInstruction puis la boucle la consomme et l'efface", async () => {
    await submitPendingInstruction("m1", "Ajoute aussi une revue de sécurité.");
    expect(fakeMission.row.pendingInstruction).toBe("Ajoute aussi une revue de sécurité.");

    const consumed = await consumePendingInstruction("m1");
    expect(consumed).toBe("Ajoute aussi une revue de sécurité.");
    expect(fakeMission.row.pendingInstruction).toBeNull(); // jamais retraitée deux fois

    const history = JSON.parse(fakeMission.row.instructionsJson!);
    expect(history).toEqual([{ text: "Ajoute aussi une revue de sécurité.", addedAt: expect.any(String) }]);
  });

  it("refuse d'écraser une instruction déjà en attente, jamais empilée silencieusement", async () => {
    await submitPendingInstruction("m1", "Première instruction.");
    await expect(submitPendingInstruction("m1", "Deuxième instruction.")).rejects.toThrow(/déjà en attente/);
    expect(fakeMission.row.pendingInstruction).toBe("Première instruction."); // jamais écrasée
  });

  it("refuse d'ajouter une instruction sur une mission déjà terminale", async () => {
    fakeMission.row.status = "SUCCEEDED";
    await expect(submitPendingInstruction("m1", "Trop tard.")).rejects.toThrow(/état terminal/);
  });

  it("consumePendingInstruction renvoie null quand rien n'est en attente — jamais une valeur fabriquée", async () => {
    const consumed = await consumePendingInstruction("m1");
    expect(consumed).toBeNull();
  });

  it("l'historique s'accumule (append-only) à travers plusieurs cycles submit/consume", async () => {
    await submitPendingInstruction("m1", "Instruction A.");
    await consumePendingInstruction("m1");
    await submitPendingInstruction("m1", "Instruction B.");
    await consumePendingInstruction("m1");

    const history = JSON.parse(fakeMission.row.instructionsJson!);
    expect(history.map((h: { text: string }) => h.text)).toEqual(["Instruction A.", "Instruction B."]);
  });
});
