import type { GroupableRecommendation, RecommendationGroup } from "@/lib/intelligence/group";

/**
 * Allège un groupe avant de le transmettre à un composant client : seuls les
 * `keepFull` premiers items (plus le représentant) conservent reason /
 * impact / actionPayloadJson ; les autres ne gardent que l'identité
 * nécessaire aux actions de groupe (ignorer, compter). Un groupe de 250
 * variantes en rupture passe ainsi de ~100 Ko à quelques Ko dans le HTML.
 * Aucune donnée n'est perdue en base — seulement non transportée.
 */
export function lightenGroup(group: RecommendationGroup, keepFull: number): RecommendationGroup {
  const items = group.items.map((item, index) =>
    index < keepFull || item.id === group.representative.id ? item : lightItem(item),
  );
  return { ...group, items };
}

function lightItem(item: GroupableRecommendation): GroupableRecommendation {
  return {
    id: item.id,
    category: item.category,
    severity: item.severity,
    title: "",
    reason: "",
    impact: "",
    confidence: item.confidence,
    actionLabel: item.actionLabel,
    actionType: item.actionType,
    actionPayloadJson: null,
    product: null,
  };
}
