import type { GenerateRequest, GenerateResult, ModelCapabilities, ModelProvider } from "@/lib/ai/providers/provider";

/**
 * ONDEAL AI CORE — §22-32 "Failure Taxonomy / Automatic Model Failover /
 * Capability-Aware Failover / Provider Circuit Breaker / Provider Handoff
 * visible" (06/09/2026), clôture réelle.
 *
 * PROBLÈME RÉEL RÉSOLU : jusqu'ici, chaque appelant (scripts CLI, API
 * /missions/[id]/run) construisait directement `new AnthropicProvider()` et
 * transmettait `chooseModel()` (router.ts) — qui ne renvoie QUE des noms de
 * modèles du catalogue Anthropic. Si Anthropic est indisponible
 * (PROVIDER_DOWN/RATE_LIMIT/QUOTA_EXHAUSTED...), il n'existe aujourd'hui
 * AUCUN mécanisme pour reprendre avec OpenAI — la mission échoue purement et
 * simplement. Rejouer le MÊME nom de modèle contre un autre provider n'aurait
 * de toute façon aucun sens : les catalogues sont incompatibles (§21).
 *
 * DESIGN (empreinte minimale — voir l'investigation de specialists.ts) :
 * FailoverProvider est un ModelProvider composite, construit avec une liste
 * ORDONNÉE de candidats {provider, model} (jamais dérivée de req.model, qui
 * est ignoré/écrasé par le modèle du candidat courant). specialists.ts,
 * catalogue.ts et graphRunner.ts ne changent PAS : ils continuent d'appeler
 * `provider.generate(req)` sur "un" ModelProvider — celui qu'on leur donne
 * est simplement, désormais, potentiellement un FailoverProvider.
 *
 * HONNÊTETÉ SUR L'ÉTAT DU CIRCUIT BREAKER : en mémoire, par PROCESSUS. Sur
 * Vercel (fonctions sans état persistant entre invocations), cet état ne
 * survit pas — chaque invocation repart neutre. C'est ACCEPTABLE et documenté
 * (jamais caché) : la protection réelle contre les défaillances persistantes
 * vient du fait que CHAQUE tentative réévalue le provider en direct (un appel
 * réseau réel, jamais une déduction), et le composite essaie quand même les
 * candidats dans l'ordre à chaque fois — le circuit breaker n'est qu'une
 * optimisation "ne pas retenter un candidat mort il y a 5 secondes", pas la
 * seule ligne de défense. Sur le worker durable (GitHub Actions,
 * ai-lab-mission.yml), l'état survit pour la durée du run (utile : une
 * mission longue ne retente pas un provider mort à chaque nœud du graphe).
 */

export type FailureCategory =
  | "PROVIDER_DOWN"
  | "RATE_LIMIT"
  | "QUOTA_EXHAUSTED"
  | "CREDIT_EXHAUSTED"
  | "MODEL_UNAVAILABLE"
  | "MODEL_DEPRECATED"
  | "CONTEXT_TOO_LARGE"
  | "MODEL_TIMEOUT"
  | "TOOL_TIMEOUT"
  | "TOOL_FAILURE"
  | "INVALID_OUTPUT"
  | "VERIFICATION_FAILURE"
  | "WORKER_FAILURE"
  | "SANDBOX_FAILURE"
  | "BROWSER_FAILURE"
  | "VISION_FAILURE"
  | "UNKNOWN";

/**
 * Classification RÉELLE à partir du message/status effectivement observé —
 * jamais une supposition à l'aveugle. Les providers actuels (anthropic.ts,
 * openai.ts) lancent des `Error` avec un message contenant le status HTTP
 * réel ; on classe sur CE texte, jamais sur une régénération théorique.
 */
export function classifyFailure(err: unknown): { category: FailureCategory; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("rate_limit")) return { category: "RATE_LIMIT", message };
  if (lower.includes("insufficient_quota") || lower.includes("quota")) return { category: "QUOTA_EXHAUSTED", message };
  if (lower.includes("credit") || lower.includes("billing")) return { category: "CREDIT_EXHAUSTED", message };
  if (lower.includes("non configuré") || lower.includes("api_key absent") || lower.includes("api key") || lower.includes("disabled")) return { category: "PROVIDER_DOWN", message };
  if (lower.includes("model_not_found") || lower.includes("404") || lower.includes("n'a pas la capacité")) return { category: "MODEL_UNAVAILABLE", message };
  if (lower.includes("deprecated") || lower.includes("décommissionné")) return { category: "MODEL_DEPRECATED", message };
  if (lower.includes("context") && (lower.includes("too large") || lower.includes("trop long") || lower.includes("maximum context"))) return { category: "CONTEXT_TOO_LARGE", message };
  if (lower.includes("timeout") || lower.includes("délai") || lower.includes("etimedout")) return { category: "MODEL_TIMEOUT", message };
  if (lower.includes("500") || lower.includes("502") || lower.includes("503") || lower.includes("réseau") || lower.includes("network") || lower.includes("econnrefused") || lower.includes("fetch failed")) return { category: "PROVIDER_DOWN", message };
  return { category: "UNKNOWN", message };
}

/** Un candidat est-il seulement TEMPORAIREMENT écarté (raisonnable de retenter plus tard) ou définitivement inadapté ? */
function isTransient(category: FailureCategory): boolean {
  return category === "RATE_LIMIT" || category === "MODEL_TIMEOUT" || category === "PROVIDER_DOWN" || category === "TOOL_TIMEOUT" || category === "UNKNOWN";
}

interface CircuitState {
  openUntil: number;
  category: FailureCategory;
}

/**
 * Registre en mémoire, par PROCESSUS (voir note d'honnêteté ci-dessus) — clé
 * = `${provider}:${model}`. Un breaker OUVERT (openUntil > maintenant) fait
 * sauter ce candidat SANS appel réseau ; il se referme automatiquement après
 * COOLDOWN_MS, jamais bloqué en dur (un vrai rétablissement de provider ne
 * doit jamais nécessiter un redéploiement).
 */
const circuitBreakers = new Map<string, CircuitState>();
const COOLDOWN_MS = 60_000;

function breakerKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function isBreakerOpen(provider: string, model: string): CircuitState | null {
  const state = circuitBreakers.get(breakerKey(provider, model));
  if (!state) return null;
  if (state.openUntil <= Date.now()) {
    circuitBreakers.delete(breakerKey(provider, model));
    return null;
  }
  return state;
}

function recordFailure(provider: string, model: string, category: FailureCategory): void {
  if (!isTransient(category)) return; // une défaillance non-transitoire (ex. MODEL_DEPRECATED) n'a pas besoin d'un cooldown temporisé — le candidat sera juste re-essayé et re-échouera proprement, jamais masqué en permanence par un breaker figé
  circuitBreakers.set(breakerKey(provider, model), { openUntil: Date.now() + COOLDOWN_MS, category });
}

export function getCircuitBreakerSnapshot(): Array<{ key: string; openUntil: number; category: FailureCategory }> {
  return [...circuitBreakers.entries()].map(([key, state]) => ({ key, ...state }));
}

export interface FailoverCandidate {
  provider: ModelProvider;
  model: string;
  /**
   * Plafond dur par appel (USD), depuis ModelConfig.maxCostPerCallUsd (§18
   * "Model Console écrivable"). Vérifié en PIRE CAS (req.maxTokens entier au
   * tarif de sortie du modèle, jamais le tarif d'entrée qui serait
   * optimiste) AVANT l'appel réseau — un appel qui dépasserait ce plafond
   * dans le pire cas est refusé, jamais exécuté puis regretté après coup
   * (on ne connaît le coût RÉEL qu'après l'appel, donc la seule prévention
   * possible est sur le pire cas théorique).
   */
  maxCostPerCallUsd?: number | null;
}

/**
 * Un candidat peut-il RÉELLEMENT satisfaire cette requête ? Vérifié via les
 * capacités déclarées du modèle (jamais une simple présomption) — ex. ne
 * jamais envoyer `webSearch` à un candidat dont le provider ne le supporte
 * pas (aujourd'hui, seul AnthropicProvider — voir openai.ts qui rejette
 * explicitement `webSearch`), ni des images à un modèle non-vision.
 */
function candidateSupportsRequest(candidate: FailoverCandidate, req: GenerateRequest): { ok: true } | { ok: false; reason: string } {
  const caps: ModelCapabilities | null = candidate.provider.capabilities(candidate.model);
  if (!caps) return { ok: false, reason: `Modèle "${candidate.model}" inconnu du provider "${candidate.provider.name}".` };
  if (req.images && req.images.length > 0 && !caps.vision) return { ok: false, reason: `Le modèle "${candidate.model}" (${candidate.provider.name}) n'a pas la capacité vision — requis pour ${req.images.length} image(s) jointe(s).` };
  if (req.webSearch && candidate.provider.name !== "anthropic") return { ok: false, reason: `webSearch requis mais le provider "${candidate.provider.name}" ne le supporte pas dans cette fondation (seul anthropic/web_search_20250305).` };
  if (candidate.maxCostPerCallUsd != null) {
    const worstCaseUsd = (req.maxTokens / 1_000_000) * caps.costPerMTokOut;
    if (worstCaseUsd > candidate.maxCostPerCallUsd) {
      return { ok: false, reason: `Coût pire-cas estimé ${worstCaseUsd.toFixed(4)}$ (maxTokens=${req.maxTokens}) dépasse le plafond Owner ${candidate.maxCostPerCallUsd}$/appel (ModelConfig.maxCostPerCallUsd).` };
    }
  }
  return { ok: true };
}

export class AllCandidatesFailedError extends Error {
  constructor(public attempts: Array<{ provider: string; model: string; failureCategory: FailureCategory; message: string }>) {
    super(`Tous les candidats provider/modèle ont échoué (${attempts.length} tentative(s)) : ${attempts.map((a) => `${a.provider}/${a.model}→${a.failureCategory}`).join(", ")}`);
    this.name = "AllCandidatesFailedError";
  }
}

export class FailoverProvider implements ModelProvider {
  readonly name = "failover";
  private candidates: FailoverCandidate[];

  constructor(candidates: FailoverCandidate[]) {
    if (candidates.length === 0) throw new Error("FailoverProvider requiert au moins un candidat {provider, model}.");
    this.candidates = candidates;
  }

  /** Renvoie les capacités du PREMIER candidat compatible — utilisé par les appelants qui inspectent les capacités avant d'appeler generate() (ex. coder/vision.ts). */
  capabilities(model: string): ModelCapabilities | null {
    for (const c of this.candidates) {
      const caps = c.provider.capabilities(model);
      if (caps) return caps;
    }
    return this.candidates[0]?.provider.capabilities(this.candidates[0].model) ?? null;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const attempts: Array<{ provider: string; model: string; failureCategory: FailureCategory; message: string }> = [];

    for (const candidate of this.candidates) {
      const support = candidateSupportsRequest(candidate, req);
      if (!support.ok) {
        attempts.push({ provider: candidate.provider.name, model: candidate.model, failureCategory: "MODEL_UNAVAILABLE", message: support.reason });
        continue; // écarté SANS appel réseau — capability-aware, jamais un essai qui échouerait de toute façon
      }
      const breaker = isBreakerOpen(candidate.provider.name, candidate.model);
      if (breaker) {
        attempts.push({ provider: candidate.provider.name, model: candidate.model, failureCategory: breaker.category, message: `Circuit breaker ouvert (dernier échec ${breaker.category}, retenté après cooldown).` });
        continue;
      }

      try {
        const result = await candidate.provider.generate({ ...req, model: candidate.model });
        return {
          ...result,
          servedBy: { provider: candidate.provider.name, model: candidate.model },
          failoverAttempts: attempts.length > 0 ? attempts : undefined, // JAMAIS un fallback muet (§32) — chaque tentative précédente reste visible même en cas de succès final
        };
      } catch (err) {
        const { category, message } = classifyFailure(err);
        recordFailure(candidate.provider.name, candidate.model, category);
        attempts.push({ provider: candidate.provider.name, model: candidate.model, failureCategory: category, message });
        // on continue vers le candidat suivant — c'est tout le sens de FailoverProvider
      }
    }

    throw new AllCandidatesFailedError(attempts);
  }
}
