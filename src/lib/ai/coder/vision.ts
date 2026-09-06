import { z } from "zod";
import type { ModelProvider } from "@/lib/ai/providers/provider";
import { chooseModel } from "@/lib/ai/models/router";
import { estimateCostUsd } from "@/lib/ai/models/cost";
import type { VisualCriticReport } from "@/lib/ai/coder/types";

/**
 * ONDEAL AI CORE — PHASE 3 : Visual Reviewer / Critic (06/09/2026), §10 de
 * la commande.
 *
 * Réutilise RÉELLEMENT le Router de PHASE 2 (`chooseModel`) sur un
 * taskSetName dédié ("coder_vision_v1") — jamais un modèle forcé en dur.
 * Tant qu'aucune évaluation Gauntlet réelle n'existe pour ce taskSetName,
 * `chooseModel` retombe explicitement sur DEFAULT_MODEL (voir router.ts) —
 * comportement attendu, pas un bug : "MESURE, ne suppose pas".
 *
 * Sortie STRUCTURÉE uniquement (zod) — jamais un jugement en texte libre
 * non validé. Si le modèle ne répond pas un JSON valide au format attendu,
 * `reviewScreenshot` lève une erreur explicite plutôt que d'inventer un
 * verdict par défaut (même principe que ModelEvalTask.verify, tasks.ts).
 */

const criticIssueSchema = z.object({
  description: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "blocker"]),
  evidence: z.string().min(1),
  recommendedFix: z.string().min(1),
});

const criticReportSchema = z.object({
  overallPass: z.boolean(),
  issues: z.array(criticIssueSchema),
});

export const VISION_TASK_SET = "coder_vision_v1";

const CRITIC_SYSTEM_PROMPT = `Tu es le Visual Reviewer d'OnDeal Intelligence. On te donne une capture d'écran réelle d'une page de l'application après une modification de code. Analyse : hiérarchie visuelle, espacement, alignement, typographie, contraste, responsive, débordement (overflow), composants cassés, cohérence visuelle globale. Réponds STRICTEMENT avec un objet JSON valide, sans texte avant ou après, au format exact :
{"overallPass": <true|false>, "issues": [{"description": "...", "severity": "low"|"medium"|"high"|"blocker", "evidence": "...", "recommendedFix": "..."}]}
"overallPass" est false s'il existe au moins un problème de sévérité "high" ou "blocker". "issues" est un tableau vide si aucun problème réel n'est visible — jamais un problème inventé pour remplir la sortie.`;

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

export interface ReviewScreenshotResult {
  report: VisualCriticReport;
  provider: string;
  model: string;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

/**
 * Envoie une capture d'écran RÉELLE (base64 PNG, voir browser.ts) au
 * meilleur modèle vision disponible selon le Router. `provider` doit
 * implémenter capabilities()+generate() (voir provider.ts) — jamais un
 * appel direct à fetch() ici, cohérent avec le reste de PHASE 2/3.
 */
export async function reviewScreenshot(
  provider: Pick<ModelProvider, "name" | "capabilities" | "generate">,
  screenshotBase64: string,
  context: { pageDescription: string },
): Promise<ReviewScreenshotResult> {
  const choice = await chooseModel(VISION_TASK_SET);
  const caps = provider.capabilities(choice.model);
  if (!caps?.vision) {
    throw new Error(`Le modèle choisi par le Router ("${choice.model}") n'a pas la capacité vision — impossible de faire une revue visuelle.`);
  }

  const result = await provider.generate({
    model: choice.model,
    system: CRITIC_SYSTEM_PROMPT,
    userMessage: `Contexte de la page : ${context.pageDescription}`,
    maxTokens: 1500,
    images: [{ mediaType: "image/png", data: screenshotBase64 }],
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(result.text));
  } catch {
    throw new Error("Le Visual Reviewer n'a pas renvoyé de JSON valide — verdict refusé plutôt qu'inventé.");
  }
  const validated = criticReportSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Sortie du Visual Reviewer non conforme au format attendu : ${validated.error.message}`);
  }

  return {
    report: validated.data,
    provider: provider.name,
    model: choice.model,
    costUsd: estimateCostUsd(provider, choice.model, result.tokensIn, result.tokensOut),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
