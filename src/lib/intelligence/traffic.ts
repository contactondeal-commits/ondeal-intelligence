import type { GeneratedRecommendation } from "@/lib/intelligence/recommendations";

// ============================================================================
// SIGNAUX TRAFIC/ACQUISITION (Google Analytics), 05/09/2026 — additif :
// n'appelle ni ne modifie AUCUNE des règles produit existantes de
// recommendations.ts. Toujours productId: null (signal boutique entière,
// jamais rattaché à un produit précis — GA4 ne remonte pas cette granularité
// dans les agrégats stockés ici). 100% déterministe sur des données déjà
// agrégées par Google — aucune invention, mêmes seuils de bruit statistique
// que le reste du moteur (jamais une conclusion sur un échantillon trop
// petit).
// ============================================================================

export interface TrafficWindow {
  sessions: number;
  conversions: number;
  revenue: number;
}

export interface ChannelTraffic {
  sourceMedium: string;
  sessions: number;
  conversions: number;
  revenue: number;
}

export interface TrafficSignalInput {
  last7Days: TrafficWindow;
  previous7Days: TrafficWindow;
  channelsLast7Days: ChannelTraffic[];
}

/** En dessous de ce volume, une variation de sessions est trop bruitée pour être un signal fiable. */
const MIN_SESSIONS_FOR_TREND = 50;
/** En dessous de ce volume par canal, "0 conversion" ne veut rien dire (trop peu de visites). */
const MIN_SESSIONS_FOR_CHANNEL_SIGNAL = 30;
const DROP_THRESHOLD_URGENT = 0.4; // -40%
const DROP_THRESHOLD_SUGGESTION = 0.25; // -25%

export function detectTrafficSignals(input: TrafficSignalInput): GeneratedRecommendation[] {
  const recs: GeneratedRecommendation[] = [];
  const { last7Days, previous7Days, channelsLast7Days } = input;

  // 🔴 Baisse de trafic semaine sur semaine — seulement si le volume de
  // référence est assez grand pour que la variation ne soit pas du bruit.
  if (previous7Days.sessions >= MIN_SESSIONS_FOR_TREND) {
    const dropRatio = (previous7Days.sessions - last7Days.sessions) / previous7Days.sessions;
    if (dropRatio >= DROP_THRESHOLD_SUGGESTION) {
      const pct = Math.round(dropRatio * 100);
      const sessionDeficit = previous7Days.sessions - last7Days.sessions;
      // Impact € estimé = revenu/session de la période de référence × sessions perdues.
      // null (jamais 0) si la période de référence n'a aucune session pour calculer un taux.
      const revenuePerSession = previous7Days.sessions > 0 ? previous7Days.revenue / previous7Days.sessions : null;
      const impactScore = revenuePerSession !== null ? revenuePerSession * Math.max(0, sessionDeficit) : null;

      recs.push({
        productId: null,
        category: "marketing",
        severity: dropRatio >= DROP_THRESHOLD_URGENT ? "URGENT" : "SUGGESTION",
        title: `Baisse de trafic — ${pct}% sur 7 jours`,
        reason: `${last7Days.sessions} sessions cette semaine contre ${previous7Days.sessions} la semaine précédente (Google Analytics).`,
        impact: "Moins de visiteurs signifie généralement moins de ventes, sauf compensation par un meilleur taux de conversion.",
        confidence: previous7Days.sessions >= 200 ? 80 : 65,
        impactScore,
        actionLabel: null,
        actionType: null,
      });
    }
  }

  // 🟠 Canal avec un trafic significatif mais AUCUNE conversion sur 7 jours.
  for (const channel of channelsLast7Days) {
    if (channel.sessions >= MIN_SESSIONS_FOR_CHANNEL_SIGNAL && channel.conversions === 0) {
      recs.push({
        productId: null,
        category: "marketing",
        severity: "OPPORTUNITY",
        title: `Canal « ${channel.sourceMedium} » : trafic sans conversion`,
        reason: `${channel.sessions} sessions sur 7 jours depuis ce canal, 0 conversion enregistrée (Google Analytics).`,
        impact: "Ce trafic ne convertit pas — vérifiez la page d'atterrissage, l'offre ou le ciblage de ce canal avant d'y investir davantage.",
        confidence: channel.sessions >= 100 ? 75 : 60,
        impactScore: null,
        actionLabel: null,
        actionType: null,
      });
    }
  }

  return recs;
}
