import { prisma } from "@/lib/db";
import {
  assessDeferredMeasurement,
  isDeferredWindowElapsed,
  pendingWindowMeasurement,
  DEFERRED_WINDOW_DAYS,
  DEFERRED_MIN_UNITS_PER_WINDOW,
  type DeferredMeasurement,
} from "@/lib/intelligence/prediction";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Unités RÉELLEMENT vendues d'une variante sur une fenêtre — même filtre de
 * "commande réelle" que partout ailleurs dans le pipeline (`order: {
 * cancelledAt: null, createdAtShopify: { ... } }`, voir
 * `rebuildMarginSnapshots` dans `src/lib/sync/shopifyStore.ts`), et même
 * champ `currentQuantity` (post-retraits/remboursements) que la marge et le
 * stock. Aucune nouvelle définition de "vente" créée ici.
 */
async function unitsSoldReal(storeId: string, variantId: string, from: Date, toExclusive: Date): Promise<number> {
  const lines = await prisma.orderLine.findMany({
    where: { variantId, order: { storeId, cancelledAt: null, createdAtShopify: { gte: from, lt: toExclusive } } },
    select: { currentQuantity: true },
  });
  return lines.reduce((sum, l) => sum + l.currentQuantity, 0);
}

/**
 * Recalcule EN DIRECT (à chaque affichage — jamais stocké, jamais une tâche
 * de fond) la mesure commerciale différée d'une action de prix déjà
 * exécutée, à partir des VRAIES commandes reçues depuis l'exécution.
 *
 * Remplace le stub qu'`measurePriceOutcome` (prediction.ts) persiste au
 * moment même de l'exécution — à cet instant, "après" n'existe pas encore,
 * le champ reste donc figé pour toujours à `insufficient_data` si on ne le
 * recalcule jamais. Lot 8 (05/09/2026) : ce module ferme cet écart en
 * relisant `OrderLine` à chaque consultation du Decision Workspace, plutôt
 * que d'ajouter une tâche planifiée qui prétendrait "apprendre" — voir le
 * principe "jamais de fausse file de tâches" du plan de session.
 */
export async function fetchDeferredPriceMeasurement(input: {
  storeId: string;
  variantId: string;
  executedAt: Date;
  windowDays?: number;
  minUnitsPerWindow?: number;
  now?: Date;
}): Promise<DeferredMeasurement> {
  const windowDays = input.windowDays ?? DEFERRED_WINDOW_DAYS;
  const minUnitsPerWindow = input.minUnitsPerWindow ?? DEFERRED_MIN_UNITS_PER_WINDOW;
  const now = input.now ?? new Date();

  if (!isDeferredWindowElapsed(input.executedAt, windowDays, now)) {
    return pendingWindowMeasurement(input.executedAt, windowDays, minUnitsPerWindow, now);
  }

  const beforeStart = new Date(input.executedAt.getTime() - windowDays * MS_PER_DAY);
  const afterEnd = new Date(input.executedAt.getTime() + windowDays * MS_PER_DAY);
  const [unitsBefore, unitsAfter] = await Promise.all([
    unitsSoldReal(input.storeId, input.variantId, beforeStart, input.executedAt),
    unitsSoldReal(input.storeId, input.variantId, input.executedAt, afterEnd),
  ]);

  return assessDeferredMeasurement({ unitsBefore, unitsAfter, windowDays, minUnitsPerWindow });
}
