/**
 * ONDEAL AI JOB ENGINE — Model Fabric, fondation (06/09/2026).
 *
 * Interface volontairement MINIMALE : une seule méthode implémentée
 * (`generate`), parce que c'est la SEULE que du code réel appelle
 * aujourd'hui (le fetch brut dans src/lib/intelligence/assistant.ts).
 * `stream`/`tool_call` (au-delà de web_search)/`vision`/`reason`/
 * `structured_output` ne sont volontairement PAS dans cette interface —
 * les ajouter maintenant, sans appelant réel, serait spéculer sur une forme
 * d'API avant qu'un provider concret (OpenAI, Google) n'en impose une vraie
 * (voir RESEARCH BEFORE IMPLEMENTATION — ne jamais deviner une API avant
 * d'en avoir besoin). Chaque méthode supplémentaire s'ajoute le jour où un
 * appelant réel en a besoin, jamais avant.
 *
 * `assistant.ts` N'A PAS ENCORE été migré vers cette interface — décision
 * délibérée de cette fondation : ce fichier est en cours de déploiement
 * production (chantier archiver/republier, 8/10 fichiers livrés au moment
 * où cette fondation est écrite) et ne doit pas être touché par un chantier
 * d'architecture séparé. La migration d'assistant.ts vers AnthropicProvider
 * est une étape ultérieure explicite, pas un effet de bord de ce commit.
 */

export interface ModelCapabilities {
  /** Contexte maximal en tokens (indicatif — utilisé par le futur Router, pas vérifié ici). */
  maxContextTokens: number;
  vision: boolean;
  toolUse: boolean;
  /** Coût indicatif, en USD, pour situer un modèle dans le futur Router coût-aware — jamais utilisé pour facturer réellement. */
  costPerMTokIn: number;
  costPerMTokOut: number;
}

export interface GenerateRequest {
  model: string;
  system: string;
  /** Un seul tour utilisateur aujourd'hui (comme assistant.ts) — pas d'historique multi-tours dans cette fondation. */
  userMessage: string;
  maxTokens: number;
  /**
   * Activation de la recherche web native — seule "capacité outil" utilisée
   * aujourd'hui (assistant.ts, ONDEAL_ENABLE_WEB_SEARCH). Pas un système de
   * tool-calling générique : ça viendra le jour où un vrai agent en aura
   * besoin (§ voir ONDEAL AI JOB ENGINE, "verification hooks" à venir).
   */
  webSearch?: { maxUses: number };
}

export interface GenerateResultCitation {
  url: string;
  title: string | null;
}

export interface GenerateResult {
  text: string;
  citations: GenerateResultCitation[];
  /** Tokens réellement consommés, quand le provider les rapporte — alimente JobStep.tokensIn/tokensOut (Observability, fondation §19 de l'audit). */
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface ModelProvider {
  readonly name: string;
  capabilities(model: string): ModelCapabilities | null;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}
