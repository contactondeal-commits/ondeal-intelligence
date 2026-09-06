/**
 * ONDEAL AI CORE — PHASE 5 (suite) : §41/§202 "provider de génération
 * d'image" (06/09/2026), clôture réelle.
 *
 * Jusqu'ici `create_image` (Tool Registry, tools/registry.ts) était
 * honnêtement toujours `NOT_CONFIGURED` — "AUCUN provider de génération
 * d'image n'est câblé aujourd'hui dans OnDeal Intelligence (jamais
 * simulé)" — parce qu'aucun ne l'était réellement. Ce fichier est ce
 * provider réel.
 *
 * Interface SÉPARÉE de `ModelProvider` (providers/provider.ts) — jamais
 * une extension spéculative de `generate()` pour un besoin structurellement
 * différent (prompt texte → image binaire, pas de "tokens" en sortie, pas
 * de vision en entrée). Même principe déjà écrit dans provider.ts : une
 * interface ne s'étend que quand un appelant réel l'exige, jamais avant.
 *
 * OpenAI Images API (dall-e-3) — même clé `OPENAI_API_KEY` que
 * `OpenAiProvider` (providers/openai.ts) : un seul compte OpenAI, deux
 * capacités distinctes de ce compte, jamais deux mécanismes de credential
 * séparés à maintenir. Health check RÉUTILISÉ (openAiHealthCheck) plutôt
 * que dupliqué — même honnêteté : DISABLED tant que l'Owner n'a pas
 * configuré la variable, jamais un statut simulé (READY_FOR_OWNER_
 * AUTHORIZATION documenté, jamais caché).
 */

import { openAiHealthCheck } from "@/lib/ai/providers/openai";

export type ImageSize = "1024x1024" | "1024x1792" | "1792x1024";
export type ImageQuality = "standard" | "hd";

export interface ImageGenerationRequest {
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
}

export interface ImageGenerationResult {
  /** PNG réel encodé en base64 (jamais une image de substitution ni une URL non vérifiée) — même convention que browser.ts::screenshot. */
  imageBase64: string;
  mediaType: "image/png";
  provider: string;
  model: string;
  revisedPrompt: string | null;
  costUsd: number | null;
}

export interface ImageGenerationProvider {
  readonly name: string;
  generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

// Tarifs OFFICIELS OpenAI Images API (USD/image, dall-e-3) — à revérifier
// contre platform.openai.com/docs/pricing avant tout usage réel à volume
// (même règle §57 que anthropic.ts/openai.ts : ne jamais se fier à la
// mémoire d'entraînement pour un tarif en production).
const DALLE3_PRICE_USD: Record<ImageQuality, Record<ImageSize, number>> = {
  standard: { "1024x1024": 0.04, "1024x1792": 0.08, "1792x1024": 0.08 },
  hd: { "1024x1024": 0.08, "1024x1792": 0.12, "1792x1024": 0.12 },
};

interface OpenAiImageResponse {
  data?: Array<{ b64_json?: string; revised_prompt?: string }>;
}

export class OpenAiImageProvider implements ImageGenerationProvider {
  readonly name = "openai";
  readonly model = "dall-e-3";

  async generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY absent — provider de génération d'image non configuré (READY_FOR_OWNER_AUTHORIZATION, voir rapport de session).");

    const size = req.size ?? "1024x1024";
    const quality = req.quality ?? "standard";

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: this.model, prompt: req.prompt, size, quality, n: 1, response_format: "b64_json" }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`OpenAI Images API a répondu ${res.status}${bodyText ? ` : ${bodyText.slice(0, 500)}` : ""}.`);
    }

    const json = (await res.json()) as OpenAiImageResponse;
    const imageBase64 = json.data?.[0]?.b64_json;
    if (!imageBase64) throw new Error("OpenAI Images API n'a renvoyé aucune image (b64_json absent) — refusé plutôt qu'une image de substitution.");

    return {
      imageBase64,
      mediaType: "image/png",
      provider: this.name,
      model: this.model,
      revisedPrompt: json.data?.[0]?.revised_prompt ?? null,
      costUsd: DALLE3_PRICE_USD[quality][size],
    };
  }
}

/** Résout le provider de génération d'image par défaut — un seul aujourd'hui, jamais un choix inventé entre plusieurs. */
export function resolveDefaultImageProvider(): ImageGenerationProvider {
  return new OpenAiImageProvider();
}

/** Réutilise le health check OpenAI existant (même compte, même clé) — jamais un second mécanisme de vérification à maintenir en cohérence. */
export async function imageGenerationHealthCheck(): Promise<{ status: "AVAILABLE" | "DISABLED" | "ERROR" | "RATE_LIMITED"; detail: string }> {
  return openAiHealthCheck();
}
