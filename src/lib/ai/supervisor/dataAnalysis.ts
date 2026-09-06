import type { WorldFact, WorldState } from "@/lib/ai/supervisor/types";

/**
 * ONDEAL AI CORE — PHASE 5 : "Data Analysis" — calcul déterministe (06/09/2026).
 *
 * §"Data Analysis Tool" de la commande AI Lab Ultimate : "calcul
 * déterministe préféré au LLM pour des maths triviales/exactes". Ce
 * module ne fait AUCUN appel modèle — il lit des `WorldFact.value`
 * numériques du World State réel et calcule un agrégat RÉEL en JS. Le
 * rôle "data_analyst" (catalogue.ts) n'utilise le modèle QUE pour narrer
 * un résultat déjà calculé ICI — jamais pour produire le chiffre lui-même
 * (§20/§77 : jamais une métrique fabriquée par le modèle).
 *
 * Volontairement MINIMAL (même principe que providers/provider.ts) : une
 * opération réelle par requête, sur des faits dont la clé matche
 * `metricKeyPrefix` — pas un langage de requête généralisé inventé sans
 * appelant réel.
 */

export type DeterministicOperation = "sum" | "avg" | "min" | "max" | "count" | "delta";

export interface DeterministicQuery {
  /** Préfixe (ou clé exacte) de WorldFact.key à agréger — ex. "margin_rate", "stock.". */
  metricKeyPrefix: string;
  operation: DeterministicOperation;
}

export interface DeterministicResult {
  query: DeterministicQuery;
  matchedFactKeys: string[];
  values: number[];
  result: number | null;
  /** Vrai si aucun fait numérique n'a matché — jamais un résultat "0" fabriqué à la place d'une absence de donnée (§15). */
  insufficientData: boolean;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Calcule un agrégat RÉEL — jamais une valeur devinée quand `values` est vide. */
export function computeDeterministic(worldState: WorldState, query: DeterministicQuery): DeterministicResult {
  const matched: WorldFact[] = worldState.facts.filter(
    (f) => f.key === query.metricKeyPrefix || f.key.startsWith(query.metricKeyPrefix),
  );
  const numeric = matched.filter((f) => isFiniteNumber(f.value)) as Array<WorldFact & { value: number }>;
  const values = numeric.map((f) => f.value);

  if (values.length === 0) {
    return { query, matchedFactKeys: matched.map((f) => f.key), values: [], result: null, insufficientData: true };
  }

  let result: number;
  switch (query.operation) {
    case "sum":
      result = values.reduce((a, b) => a + b, 0);
      break;
    case "avg":
      result = values.reduce((a, b) => a + b, 0) / values.length;
      break;
    case "min":
      result = Math.min(...values);
      break;
    case "max":
      result = Math.max(...values);
      break;
    case "count":
      result = values.length;
      break;
    case "delta":
      // Écart entre la première et la dernière valeur RÉELLEMENT trouvée
      // (ordre du World State, jamais un tri implicite qui inventerait une
      // chronologie non garantie par la source).
      result = values[values.length - 1]! - values[0]!;
      break;
  }
  return { query, matchedFactKeys: matched.map((f) => f.key), values, result, insufficientData: false };
}
