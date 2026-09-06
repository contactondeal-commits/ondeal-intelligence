import type { ModelProvider } from "@/lib/ai/providers/provider";

/**
 * ONDEAL AI CORE — coût observable (PHASE 2, 06/09/2026).
 *
 * Un seul point de calcul du coût USD d'un appel modèle, à partir des
 * tokens RÉELLEMENT rapportés par le provider (jamais estimés à partir de
 * la longueur du texte) et du tarif déclaré par `provider.capabilities()`
 * — la même fonction que le futur Router utilisera pour comparer des
 * modèles (voir router.ts). Retourne `null`, jamais 0, quand un ingrédient
 * réel manque (tokens non rapportés, ou modèle absent du catalogue de
 * capacités) — un coût de 0$ non justifié serait une donnée inventée,
 * exactement ce que la règle REAL > CALCULATED > jamais inventé interdit.
 */
export function estimateCostUsd(
  provider: Pick<ModelProvider, "capabilities">,
  model: string,
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): number | null {
  if (tokensIn == null || tokensOut == null) return null;
  const caps = provider.capabilities(model);
  if (!caps) return null;
  return (tokensIn * caps.costPerMTokIn + tokensOut * caps.costPerMTokOut) / 1_000_000;
}
