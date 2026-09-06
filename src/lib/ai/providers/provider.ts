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
 * production (chantier archiver/républier, 8/10 fichiers livrés au moment
 * où cette fondation est écrite) et ne doit pas être touché par un chantier
 * d'architecture séparé. La migration d'assistant.ts vers AnthropicProvider
 * est une étape ultérieure explicite, pas un effet de bord de ce commit.
 *
 * PHASE 3 (06/09/2026) : `images` s'ajoute à GenerateRequest parce qu'un
 * appelant RÉEL en a maintenant besoin — le Visual Reviewer/Critic du Coder
 * Agent (src/lib/ai/coder/vision.ts) envoie une capture d'écran RÉELLE
 * (Playwright) au modèle. `ModelCapabilities.vision` existait déjà depuis
 * PHASE 2 mais n'était vérifié par aucun appelant ; c'est désormais le cas
 * (voir vision.ts : refuse d'appeler un modèle dont `capabilities().vision`
 * est faux, jamais un appel silencieusement dégradé en texte seul).
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
  /**
   * Images RÉELLES (jamais une description texte substituée) à joindre au
   * tour utilisateur — voir Coder Agent / Visual Reviewer. `data` est le
   * contenu déjà encodé en base64 (jamais une URL distante non vérifiée —
   * évite tout SSRF côté provider). Un provider dont `capabilities(model)
   * .vision` est faux DOIT rejeter une requête avec `images` non vide
   * plutôt que d'ignorer silencieusement les images (voir anthropic.ts).
   */
  images?: Array<{ mediaType: "image/png" | "image/jpeg" | "image/webp"; data: string }>;
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
  /**
   * §22-32 "provider continuity" (06/09/2026) — quel provider/modèle a
   * RÉELLEMENT servi cette réponse. Absent (undefined) pour un ModelProvider
   * simple (Anthropic/OpenAI directement) : dans ce cas l'appelant connaît
   * déjà le provider/modèle qu'il a lui-même choisi. Rempli UNIQUEMENT par
   * un composite comme FailoverProvider, où le candidat qui a réussi peut
   * différer du premier choix — jamais un provider "de base" ne doit deviner
   * ou fabriquer cette valeur, seul le composite qui a fait l'essai le sait.
   */
  servedBy?: { provider: string; model: string };
  /**
   * Historique des candidats essayés avant celui qui a réussi (jamais
   * silencieux — §32 "Provider Handoff UI toujours visible, jamais un
   * fallback muet"). Vide/absent si le premier candidat a réussi du premier
   * coup.
   */
  failoverAttempts?: Array<{ provider: string; model: string; failureCategory: string; message: string }>;
}

export interface ModelProvider {
  readonly name: string;
  capabilities(model: string): ModelCapabilities | null;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}
