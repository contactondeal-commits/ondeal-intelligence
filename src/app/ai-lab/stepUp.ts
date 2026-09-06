import { startAuthentication } from "@simplewebauthn/browser";

/**
 * ONDEAL AI CORE — §"sensitive-action gates / step-up authentication"
 * (06/09/2026), clôture UI réelle.
 *
 * Aide client réutilisable : effectue une VRAIE cérémonie WebAuthn de
 * step-up (options → cérémonie navigateur → verify) juste avant une action
 * sensible, DEPUIS l'interface AI Lab — jamais un bouton qui "simule" un
 * step-up. Toute route protégée par `requireCapabilityWithStepUp` répond
 * 403 si le step-up n'a pas été fait dans les 5 dernières minutes ; les
 * appelants (voir performStepUpThenCall ci-dessous) rattrapent EXACTEMENT
 * cette réponse pour proposer la cérémonie à la volée, jamais en pré-emptif
 * (on ne fait la cérémonie WebAuthn — friction réelle pour l'Owner — que
 * quand le serveur dit qu'elle est réellement nécessaire).
 */

export class StepUpRequiredError extends Error {}

export async function performStepUp(): Promise<void> {
  const optRes = await fetch("/api/owner/step-up/options", { method: "POST" });
  if (!optRes.ok) {
    const body = await optRes.json().catch(() => ({}));
    throw new StepUpRequiredError(body.error ?? "Impossible d'obtenir les options de step-up (session Owner absente ou expirée — reconnectez-vous sur /owner-auth).");
  }
  const options = await optRes.json();
  const assertion = await startAuthentication({ optionsJSON: options });
  const verifyRes = await fetch("/api/owner/step-up/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response: assertion }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.json().catch(() => ({}));
    throw new StepUpRequiredError(body.error ?? "Step-up WebAuthn échoué.");
  }
}

async function apiRaw(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) } });
}

/**
 * Exécute `call` ; si le serveur répond 403 avec un message évoquant un
 * step-up requis, propose RÉELLEMENT la cérémonie WebAuthn (window.confirm
 * — jamais silencieux, l'Owner voit toujours qu'une ré-authentification a
 * lieu) puis rejoue `call` UNE fois. Un second échec après step-up est
 * remonté tel quel (jamais masqué).
 */
export async function callWithStepUp<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
  const res = await apiRaw(url, opts);
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    const message = String(body.error ?? "");
    if (/step-up|élévation|re-authentif/i.test(message)) {
      const proceed = typeof window !== "undefined" ? window.confirm("Cette action nécessite une ré-authentification (step-up WebAuthn). Continuer avec votre clé de sécurité ?") : true;
      if (!proceed) throw new Error(message);
      await performStepUp();
      const retryRes = await apiRaw(url, opts);
      const retryBody = await retryRes.json().catch(() => ({}));
      if (!retryRes.ok) throw new Error((retryBody as { error?: string }).error ?? `Erreur HTTP ${retryRes.status}`);
      return retryBody as T;
    }
    throw new Error(message || `Erreur HTTP ${res.status}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Erreur HTTP ${res.status}`);
  return body as T;
}
