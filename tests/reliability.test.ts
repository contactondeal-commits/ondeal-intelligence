import { describe, it, expect } from "vitest";
import { computeActionReliability, type ReliabilityCountRow } from "@/lib/intelligence/reliability";

describe("computeActionReliability", () => {
  it("retourne des buckets vides et un taux null quand aucune décision n'a été prise", () => {
    const r = computeActionReliability([]);
    expect(r.overall).toEqual({ actioned: 0, dismissed: 0, decided: 0, actionRate: null });
    expect(r.bySeverity.URGENT.actionRate).toBeNull();
  });

  it("calcule le taux d'action global comme actioned / (actioned + dismissed)", () => {
    const rows: ReliabilityCountRow[] = [
      { severity: "URGENT", status: "ACTIONED", count: 8 },
      { severity: "URGENT", status: "DISMISSED", count: 2 },
      { severity: "SUGGESTION", status: "ACTIONED", count: 1 },
      { severity: "SUGGESTION", status: "DISMISSED", count: 9 },
    ];
    const r = computeActionReliability(rows);
    expect(r.overall.actioned).toBe(9);
    expect(r.overall.dismissed).toBe(11);
    expect(r.overall.decided).toBe(20);
    expect(r.overall.actionRate).toBeCloseTo(0.45, 5);
  });

  it("calcule un taux distinct par sévérité — révèle les écarts que le taux global masque", () => {
    const rows: ReliabilityCountRow[] = [
      { severity: "URGENT", status: "ACTIONED", count: 8 },
      { severity: "URGENT", status: "DISMISSED", count: 2 },
      { severity: "SUGGESTION", status: "ACTIONED", count: 1 },
      { severity: "SUGGESTION", status: "DISMISSED", count: 9 },
    ];
    const r = computeActionReliability(rows);
    expect(r.bySeverity.URGENT.actionRate).toBeCloseTo(0.8, 5);
    expect(r.bySeverity.SUGGESTION.actionRate).toBeCloseTo(0.1, 5);
    expect(r.bySeverity.OPPORTUNITY.actionRate).toBeNull();
  });

  it("ignore une ligne de sévérité inconnue plutôt que de fausser le total", () => {
    // Cast volontaire : simule une valeur de sévérité inattendue arrivant de la base
    // (colonne élargie côté schéma sans mise à jour de ce type, par exemple).
    const rows = [
      { severity: "URGENT", status: "ACTIONED", count: 3 },
      { severity: "UNKNOWN", status: "ACTIONED", count: 100 },
    ] as unknown as ReliabilityCountRow[];
    const r = computeActionReliability(rows);
    expect(r.overall.actioned).toBe(3);
  });
});
