import { describe, it, expect } from "vitest";
import { detectTrafficSignals, type TrafficSignalInput } from "@/lib/intelligence/traffic";

function baseInput(overrides: Partial<TrafficSignalInput> = {}): TrafficSignalInput {
  return {
    last7Days: { sessions: 100, conversions: 5, revenue: 500 },
    previous7Days: { sessions: 100, conversions: 5, revenue: 500 },
    channelsLast7Days: [],
    ...overrides,
  };
}

describe("detectTrafficSignals", () => {
  it("ne détecte rien quand le trafic est stable", () => {
    const recs = detectTrafficSignals(baseInput());
    expect(recs).toEqual([]);
  });

  it("ignore une baisse de trafic si la période de référence est trop petite pour être fiable", () => {
    const recs = detectTrafficSignals(
      baseInput({
        previous7Days: { sessions: 40, conversions: 2, revenue: 200 },
        last7Days: { sessions: 5, conversions: 0, revenue: 0 },
      }),
    );
    expect(recs).toEqual([]);
  });

  it("signale une baisse de trafic ≥25% en SUGGESTION", () => {
    const recs = detectTrafficSignals(
      baseInput({
        previous7Days: { sessions: 200, conversions: 10, revenue: 1000 },
        last7Days: { sessions: 140, conversions: 7, revenue: 700 }, // -30%
      }),
    );
    expect(recs).toHaveLength(1);
    expect(recs[0]!.category).toBe("marketing");
    expect(recs[0]!.productId).toBeNull();
    expect(recs[0]!.severity).toBe("SUGGESTION");
    expect(recs[0]!.title).toContain("30%");
  });

  it("signale une baisse de trafic ≥40% en URGENT, avec un impact estimé en euros", () => {
    const recs = detectTrafficSignals(
      baseInput({
        previous7Days: { sessions: 200, conversions: 10, revenue: 1000 }, // 5€/session
        last7Days: { sessions: 100, conversions: 5, revenue: 500 }, // -50%
      }),
    );
    expect(recs).toHaveLength(1);
    expect(recs[0]!.severity).toBe("URGENT");
    // 100 sessions perdues × 5€/session de référence = 500€
    expect(recs[0]!.impactScore).toBeCloseTo(500, 5);
  });

  it("n'invente jamais un impact € si la période de référence n'a aucune session", () => {
    const recs = detectTrafficSignals(
      baseInput({
        previous7Days: { sessions: 0, conversions: 0, revenue: 0 },
        last7Days: { sessions: 0, conversions: 0, revenue: 0 },
        channelsLast7Days: [],
      }),
    );
    expect(recs).toEqual([]);
  });

  it("ignore un canal à faible volume — 0 conversion n'est pas un signal fiable sous le seuil", () => {
    const recs = detectTrafficSignals(baseInput({ channelsLast7Days: [{ sourceMedium: "tiktok / cpc", sessions: 10, conversions: 0, revenue: 0 }] }));
    expect(recs).toEqual([]);
  });

  it("signale un canal à trafic significatif sans aucune conversion, en OPPORTUNITY", () => {
    const recs = detectTrafficSignals(
      baseInput({ channelsLast7Days: [{ sourceMedium: "facebook / cpc", sessions: 80, conversions: 0, revenue: 0 }] }),
    );
    expect(recs).toHaveLength(1);
    expect(recs[0]!.severity).toBe("OPPORTUNITY");
    expect(recs[0]!.category).toBe("marketing");
    expect(recs[0]!.productId).toBeNull();
    expect(recs[0]!.title).toContain("facebook / cpc");
  });

  it("ne signale pas un canal qui convertit, même à faible taux", () => {
    const recs = detectTrafficSignals(baseInput({ channelsLast7Days: [{ sourceMedium: "google / organic", sessions: 500, conversions: 1, revenue: 50 }] }));
    expect(recs).toEqual([]);
  });

  it("cumule un signal de baisse globale ET des signaux de canaux morts dans le même appel", () => {
    const recs = detectTrafficSignals({
      previous7Days: { sessions: 300, conversions: 15, revenue: 1500 },
      last7Days: { sessions: 150, conversions: 8, revenue: 800 }, // -50%
      channelsLast7Days: [
        { sourceMedium: "tiktok / cpc", sessions: 60, conversions: 0, revenue: 0 },
        { sourceMedium: "google / organic", sessions: 90, conversions: 8, revenue: 800 },
      ],
    });
    expect(recs).toHaveLength(2);
    expect(recs.some((r) => r.severity === "URGENT")).toBe(true);
    expect(recs.some((r) => r.title.includes("tiktok / cpc"))).toBe(true);
  });
});
