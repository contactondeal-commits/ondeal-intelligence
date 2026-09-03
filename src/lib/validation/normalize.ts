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
}

export interface NormalizedVariant {
  shopifyVariantId: string;
  title: string;
  sku: string | null;
  price: number | null;
  compareAtPrice: number | null;
  inventoryQuantity: number | null;
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

  const compareAtPrice = toFiniteNumberOrNull(raw.compareAtPrice);

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
