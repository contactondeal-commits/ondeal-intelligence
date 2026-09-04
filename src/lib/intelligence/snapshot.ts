/**
 * Snapshot de simulation — PRIORITÉ ABSOLUE de la consolidation Decision
 * Workspace (session du 03/09/2026).
 *
 * Problème réel à empêcher : une simulation affichée à l'écran (prix, coûts,
 * stock) peut devenir obsolète entre le moment où l'utilisateur la regarde
 * et le moment où il clique sur « Exécuter » — une synchronisation Shopify,
 * une autre action, ou un changement manuel peut avoir modifié les données
 * entre-temps. Sans protection, OnDeal appliquerait alors un changement
 * calculé sur une donnée qui n'est plus vraie.
 *
 * Ce module ne remplace ni ne duplique `simulate.ts` (le calcul de marge/
 * stock reste dans `analyzeMargin`/`analyzeStock`) : il capture les données
 * réelles qui ont servi à la simulation au moment où l'utilisateur CONFIRME
 * sa décision, puis les compare aux données réelles au moment où OnDeal
 * s'apprête à exécuter réellement la mutation. Le snapshot est persisté tel
 * quel dans `ActionItem.payloadJson` (champ `simulationSnapshot`) — aucune
 * migration de schéma n'est nécessaire.
 */

export interface PriceSnapshotFields {
  currentPrice: number | null;
  supplierCost: number | null;
  shippingCost: number | null;
  paymentFeesRate: number | null;
  otherFixedCost: number | null;
}

export interface PriceSimulationSnapshot extends PriceSnapshotFields {
  kind: "price";
  productId: string;
  variantId: string;
  /** Horodatage de CAPTURE des données (confirmation), jamais celui de l'affichage écran. */
  observedAt: string;
  /** Valeur candidate (nouveau prix) au moment de la confirmation. */
  candidateValue: number;
}

export interface ChangedSnapshotField {
  field: string;
  label: string;
  expected: number | null;
  actual: number | null;
}

export interface SnapshotComparison {
  stale: boolean;
  changedFields: ChangedSnapshotField[];
}

const PRICE_SNAPSHOT_FIELDS: Array<keyof PriceSnapshotFields> = [
  "currentPrice",
  "supplierCost",
  "shippingCost",
  "paymentFeesRate",
  "otherFixedCost",
];

const FIELD_LABEL: Record<keyof PriceSnapshotFields, string> = {
  currentPrice: "Prix actuel",
  supplierCost: "Coût fournisseur",
  shippingCost: "Frais d'expédition",
  paymentFeesRate: "Taux de frais de paiement",
  otherFixedCost: "Autre coût fixe",
};

// Tolérances par champ — un centime pour les montants en euros (imprécision
// flottante uniquement), un dix-millième pour un taux (paymentFeesRate est
// une fraction, ex. 0.029 pour 2.9%). Un écart réel doit toujours dépasser
// ces tolérances pour être considéré comme un changement.
const TOLERANCE: Record<keyof PriceSnapshotFields, number> = {
  currentPrice: 0.01,
  supplierCost: 0.01,
  shippingCost: 0.01,
  otherFixedCost: 0.01,
  paymentFeesRate: 0.0001,
};

function fieldDiffers(expected: number | null, actual: number | null, tolerance: number): boolean {
  if (expected === null && actual === null) return false;
  // Une donnée qui apparaît ou disparaît est un changement réel — jamais
  // traité comme "pas de différence" par défaut.
  if (expected === null || actual === null) return true;
  return Math.abs(expected - actual) > tolerance;
}

export function buildPriceSnapshot(input: {
  productId: string;
  variantId: string;
  candidateValue: number;
  fields: PriceSnapshotFields;
  observedAt?: Date;
}): PriceSimulationSnapshot {
  return {
    kind: "price",
    productId: input.productId,
    variantId: input.variantId,
    observedAt: (input.observedAt ?? new Date()).toISOString(),
    candidateValue: input.candidateValue,
    ...input.fields,
  };
}

/**
 * Compare le snapshot capturé à la confirmation aux données réelles
 * observées juste avant l'exécution. `stale: true` signifie qu'au moins une
 * donnée critique a réellement changé — l'exécution doit être refusée.
 */
export function comparePriceSnapshot(snapshot: PriceSnapshotFields, current: PriceSnapshotFields): SnapshotComparison {
  const changedFields: ChangedSnapshotField[] = [];
  for (const field of PRICE_SNAPSHOT_FIELDS) {
    const expected = snapshot[field];
    const actual = current[field];
    if (fieldDiffers(expected, actual, TOLERANCE[field])) {
      changedFields.push({ field, label: FIELD_LABEL[field], expected, actual });
    }
  }
  return { stale: changedFields.length > 0, changedFields };
}

function formatFieldValue(field: string, value: number | null): string {
  if (value === null) return "inconnu";
  return field === "paymentFeesRate" ? `${(value * 100).toFixed(2)}%` : `${value.toFixed(2)} €`;
}

/**
 * Message explicite destiné à l'utilisateur — jamais un simple "obsolète",
 * toujours ce qui a changé exactement, comme demandé.
 */
export function describeSnapshotChange(comparison: SnapshotComparison): string {
  if (!comparison.stale) return "";
  const parts = comparison.changedFields.map(
    (c) => `${c.label} : ${formatFieldValue(c.field, c.expected)} → ${formatFieldValue(c.field, c.actual)}`,
  );
  return `Les données ont changé depuis votre simulation (${parts.join(" ; ")}). Une nouvelle simulation est nécessaire avant l'exécution.`;
}

/** Type guard — vérifie qu'une valeur lue depuis un payloadJson parsé est bien un snapshot prix exploitable. */
export function isPriceSnapshot(value: unknown): value is PriceSimulationSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.kind === "price" && typeof v.productId === "string" && typeof v.variantId === "string" && typeof v.candidateValue === "number";
}

// ---------------------------------------------------------------------------
// SNAPSHOT STOCK — même architecture que le snapshot prix, appliquée à la
// preuve (stock actuel, vélocité de vente) qui justifie une mission
// "review_supplier" (rupture / rupture imminente / incohérence fournisseur).
//
// Différence assumée avec le prix : `review_supplier` n'a aujourd'hui AUCUNE
// mutation Shopify réelle (voir `actionKind.ts` — c'est une MANUAL MISSION).
// Il n'y a donc pas de "valeur candidate exécutée" à protéger comme pour
// `update_price`. Ce qui doit être protégé, c'est la PREUVE elle-même : si le
// stock ou la vélocité ont réellement changé entre la préparation de la
// mission et le moment où l'utilisateur la marque comme effectuée, la
// prémisse ("il y a une rupture à traiter") peut ne plus être vraie — la
// mission ne doit pas être close silencieusement sur une preuve obsolète.
// ---------------------------------------------------------------------------

export interface StockSnapshotFields {
  currentStock: number | null;
  dailyVelocity: number | null;
}

export interface StockSimulationSnapshot extends StockSnapshotFields {
  kind: "stock";
  productId: string;
  variantId: string;
  observedAt: string;
  /** Quantité simulée par l'utilisateur au moment de la décision, si renseignée — purement informative : aucune mutation Shopify n'en dépend aujourd'hui. */
  candidateAddedUnits: number | null;
}

const STOCK_SNAPSHOT_FIELDS: Array<keyof StockSnapshotFields> = ["currentStock", "dailyVelocity"];

const STOCK_FIELD_LABEL: Record<keyof StockSnapshotFields, string> = {
  currentStock: "Stock actuel",
  dailyVelocity: "Vélocité de vente",
};

// Le stock est un compte entier réel (pas une valeur flottante recalculée) :
// aucune tolérance, tout écart est un vrai changement. La vélocité est
// dérivée (unités vendues / 30) : une tolérance minime absorbe uniquement
// l'imprécision flottante, pas un vrai écart (le plus petit écart réel
// possible est 1/30 ≈ 0.033).
const STOCK_TOLERANCE: Record<keyof StockSnapshotFields, number> = {
  currentStock: 0,
  dailyVelocity: 0.005,
};

export function buildStockSnapshot(input: {
  productId: string;
  variantId: string;
  candidateAddedUnits: number | null;
  fields: StockSnapshotFields;
  observedAt?: Date;
}): StockSimulationSnapshot {
  return {
    kind: "stock",
    productId: input.productId,
    variantId: input.variantId,
    observedAt: (input.observedAt ?? new Date()).toISOString(),
    candidateAddedUnits: input.candidateAddedUnits,
    ...input.fields,
  };
}

/** Même logique que `comparePriceSnapshot`, appliquée aux deux champs de preuve du stock. */
export function compareStockSnapshot(snapshot: StockSnapshotFields, current: StockSnapshotFields): SnapshotComparison {
  const changedFields: ChangedSnapshotField[] = [];
  for (const field of STOCK_SNAPSHOT_FIELDS) {
    const expected = snapshot[field];
    const actual = current[field];
    if (fieldDiffers(expected, actual, STOCK_TOLERANCE[field])) {
      changedFields.push({ field, label: STOCK_FIELD_LABEL[field], expected, actual });
    }
  }
  return { stale: changedFields.length > 0, changedFields };
}

function formatStockFieldValue(field: string, value: number | null): string {
  if (value === null) return "inconnu";
  return field === "dailyVelocity" ? `≈ ${value.toFixed(2)} / jour` : `${value} unité(s)`;
}

export function describeStockSnapshotChange(comparison: SnapshotComparison): string {
  if (!comparison.stale) return "";
  const parts = comparison.changedFields.map(
    (c) => `${c.label} : ${formatStockFieldValue(c.field, c.expected)} → ${formatStockFieldValue(c.field, c.actual)}`,
  );
  return `Les données de stock ont changé depuis la préparation de cette mission (${parts.join(" ; ")}). Une nouvelle simulation est nécessaire avant de la marquer comme effectuée.`;
}

export function isStockSnapshot(value: unknown): value is StockSimulationSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.kind === "stock" && typeof v.productId === "string" && typeof v.variantId === "string";
}
