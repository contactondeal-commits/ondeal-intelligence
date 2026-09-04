// PHASE 16 — Qualité des données. Détection ET correction à la source des
// problèmes courants issus des API externes (Shopify/Judge.me), avant tout
// stockage. Chaque anomalie corrigée est retournée dans `issues` pour rester
// traçable (jamais masquée silencieusement dans l'UI).

export interface NormalizeIssue {
  field: string;
  problem: string;
  original: unknown;
  corrected: unknown;
}

export interface RawShopifyVariant {
  id?: string | null;
  title?: string | null;
  sku?: string | null;
  price?: string | number | null;
  compareAtPrice?: string | number | null;
  inventoryQuantity?: number | null;
  inventoryItem?: { tracked?: boolean; unitCost?: { amount?: string | number | null; currencyCode?: string | null } | null } | null;
}

export interface NormalizedVariant {
  shopifyVariantId: string;
  title: string;
  sku: string | null;
  price: number | null;
  compareAtPrice: number | null;
  inventoryQuantity: number | null;
  /** Coût unitaire réel Shopify (inventoryItem.unitCost), null si non renseigné côté Shopify. */
  unitCost: number | null;
  unitCostCurrency: string | null;
}

function toFiniteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || Number.isNaN(n) || !Number.isFinite(n)) return null;
  return n;
}

/**
 * Normalise une variante brute Shopify. Retourne `null` (variante rejetée)
 * si l'identifiant est absent — une variante orpheline sans id ne peut pas
 * être stockée de façon fiable. Tout le reste est corrigé/annoté plutôt que
 * de faire échouer l'import entier.
 */
export function normalizeVariant(
  raw: RawShopifyVariant,
): { variant: NormalizedVariant; issues: NormalizeIssue[] } | { variant: null; issues: NormalizeIssue[] } {
  const issues: NormalizeIssue[] = [];

  if (!raw.id) {
    return {
      variant: null,
      issues: [{ field: "id", problem: "variante orpheline sans identifiant Shopify", original: raw, corrected: null }],
    };
  }

  const price = toFiniteNumberOrNull(raw.price);
  if (raw.price !== undefined && raw.price !== null && price === null) {
    issues.push({ field: "price", problem: "prix invalide (NaN/non numérique)", original: raw.price, corrected: null });
  } else if (price !== null && price < 0) {
    issues.push({ field: "price", problem: "prix négatif ramené à null", original: raw.price, corrected: null });
  }

  // compareAtPrice — QUALITÉ DE DONNÉES, sans altérer la valeur Shopify :
  // la valeur est stockée telle quelle (jamais "corrigée" arbitrairement),
  // mais deux cas manifestement incohérents sont SIGNALÉS pour que ni
  // l'UI ni le marketing ne les prennent pour une vraie promotion :
  //   - 0.00 : Shopify n'a pas de "prix barré" ; certains imports écrivent 0
  //     à la place de null → stocké null (0 n'a aucun sens métier), signalé.
  //   - inférieur ou égal au prix : un "prix barré" plus bas que le prix de
  //     vente n'est pas une promotion (souvent un coût importé au mauvais
  //     endroit) → conservé tel quel, signalé.
  let compareAtPrice = toFiniteNumberOrNull(raw.compareAtPrice);
  if (compareAtPrice !== null && compareAtPrice === 0) {
    issues.push({ field: "compareAtPrice", problem: "prix barré à 0 (absence de promotion) ramené à null", original: raw.compareAtPrice, corrected: null });
    compareAtPrice = null;
  } else if (compareAtPrice !== null && price !== null && compareAtPrice <= price) {
    issues.push({
      field: "compareAtPrice",
      problem: "prix barré inférieur ou égal au prix de vente (pas une promotion) — conservé tel quel",
      original: raw.compareAtPrice,
      corrected: compareAtPrice,
    });
  }

  // unitCost — coût réel Shopify. null reste null : jamais remplacé par 0 ni
  // par une hypothèse OnDeal.
  const rawUnitCost = raw.inventoryItem?.unitCost ?? null;
  let unitCost = rawUnitCost ? toFiniteNumberOrNull(rawUnitCost.amount) : null;
  let unitCostCurrency = rawUnitCost?.currencyCode ?? null;
  if (unitCost !== null && unitCost < 0) {
    issues.push({ field: "unitCost", problem: "coût unitaire négatif ramené à null", original: rawUnitCost?.amount, corrected: null });
    unitCost = null;
  }
  if (unitCost === null) unitCostCurrency = null;
  if (unitCost !== null && unitCost === 0) {
    // 0 est une valeur réelle possible (produit gratuit) mais le plus souvent
    // un coût non renseigné : conservé, signalé.
    issues.push({ field: "unitCost", problem: "coût unitaire à 0 — conservé, à vérifier", original: rawUnitCost?.amount, corrected: 0 });
  }

  let inventoryQuantity = raw.inventoryQuantity ?? null;
  if (inventoryQuantity !== null && (Number.isNaN(inventoryQuantity) || inventoryQuantity < 0)) {
    issues.push({
      field: "inventoryQuantity",
      problem: "stock incohérent (négatif ou NaN) ramené à 0",
      original: raw.inventoryQuantity,
      corrected: 0,
    });
    inventoryQuantity = 0;
  }

  return {
    variant: {
      shopifyVariantId: String(raw.id),
      title: raw.title?.trim() || "Default",
      sku: raw.sku?.trim() || null,
      price: price !== null && price >= 0 ? price : null,
      compareAtPrice: compareAtPrice !== null && compareAtPrice >= 0 ? compareAtPrice : null,
      inventoryQuantity,
      unitCost,
      unitCostCurrency,
    },
    issues,
  };
}

export function normalizeHandle(handle: string | null | undefined, fallbackId: string): { handle: string; issue: NormalizeIssue | null } {
  if (handle && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(handle)) {
    return { handle, issue: null };
  }
  const corrected = `produit-${fallbackId}`;
  return {
    handle: corrected,
    issue: { field: "handle", problem: "handle invalide ou manquant", original: handle, corrected },
  };
}

export function detectDuplicateExternalIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}
