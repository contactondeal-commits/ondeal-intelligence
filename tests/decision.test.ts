import { describe, it, expect } from "vitest";
import { derivePhaseFromExistingAction, isPriceStale, isStaleResult } from "@/lib/intelligence/decision";

describe("derivePhaseFromExistingAction", () => {
  it("part de 'signal' quand aucune action n'existe encore", () => {
    expect(derivePhaseFromExistingAction(null)).toBe("signal");
  });

  it("reprend à 'confirm' pour une action SENSITIVE en attente de validation (jamais recréée en double)", () => {
    expect(derivePhaseFromExistingAction({ status: "PENDING_VALIDATION", sensitivity: "SENSITIVE" })).toBe("confirm");
  });

  it("reprend à 'ready-execute' pour une action SAFE en attente (aucune confirmation humaine requise)", () => {
    expect(derivePhaseFromExistingAction({ status: "PENDING_VALIDATION", sensitivity: "SAFE" })).toBe("ready-execute");
  });

  it("reprend à 'ready-execute' pour toute action déjà CONFIRMED", () => {
    expect(derivePhaseFromExistingAction({ status: "CONFIRMED", sensitivity: "SENSITIVE" })).toBe("ready-execute");
    expect(derivePhaseFromExistingAction({ status: "CONFIRMED", sensitivity: "SAFE" })).toBe("ready-execute");
  });

  it("affiche l'état terminal pour EXECUTED et FAILED", () => {
    expect(derivePhaseFromExistingAction({ status: "EXECUTED", sensitivity: "SAFE" })).toBe("done-success");
    expect(derivePhaseFromExistingAction({ status: "FAILED", sensitivity: "SENSITIVE" })).toBe("done-failed");
  });

  it("repart de 'signal' pour une action annulée", () => {
    expect(derivePhaseFromExistingAction({ status: "CANCELLED", sensitivity: "SAFE" })).toBe("signal");
  });

  it("distingue une simulation obsolète (phase 'stale') d'un échec ordinaire (FAILED), sans nouvel enum en base", () => {
    const staleResult = JSON.stringify({ ok: false, kind: "stale_simulation", detail: "…" });
    expect(derivePhaseFromExistingAction({ status: "FAILED", sensitivity: "SENSITIVE", resultJson: staleResult })).toBe("stale");

    const ordinaryFailure = JSON.stringify({ ok: false, kind: "error", detail: "Shopify indisponible" });
    expect(derivePhaseFromExistingAction({ status: "FAILED", sensitivity: "SENSITIVE", resultJson: ordinaryFailure })).toBe("done-failed");
  });

  it("FAILED sans resultJson (ou illisible) reste un échec ordinaire, jamais 'stale' par défaut", () => {
    expect(derivePhaseFromExistingAction({ status: "FAILED", sensitivity: "SAFE" })).toBe("done-failed");
    expect(derivePhaseFromExistingAction({ status: "FAILED", sensitivity: "SAFE", resultJson: "{not json" })).toBe("done-failed");
  });
});

describe("isStaleResult", () => {
  it("reconnaît un résultat taggé stale_simulation", () => {
    expect(isStaleResult(JSON.stringify({ kind: "stale_simulation" }))).toBe(true);
  });
  it("rejette un résultat ordinaire, absent, ou illisible", () => {
    expect(isStaleResult(JSON.stringify({ kind: "error" }))).toBe(false);
    expect(isStaleResult(null)).toBe(false);
    expect(isStaleResult(undefined)).toBe(false);
    expect(isStaleResult("{not json")).toBe(false);
  });
});

describe("isPriceStale", () => {
  it("détecte un écart réel de prix entre la simulation et l'exécution", () => {
    expect(isPriceStale(19.9, 24.5)).toBe(true);
  });

  it("tolère les imprécisions flottantes négligeables (moins d'un centime)", () => {
    expect(isPriceStale(19.9, 19.900001)).toBe(false);
  });

  it("ne bloque pas quand une des deux valeurs est inconnue (rien à comparer)", () => {
    expect(isPriceStale(null, 19.9)).toBe(false);
    expect(isPriceStale(19.9, null)).toBe(false);
  });

  it("n'est pas obsolète quand le prix n'a pas changé", () => {
    expect(isPriceStale(19.9, 19.9)).toBe(false);
  });
});
