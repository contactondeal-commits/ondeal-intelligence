import { prisma } from "@/lib/db";
import { encryptJson, decryptJson } from "@/lib/crypto";

/**
 * ONDEAL AI CORE — connecteur GitHub RÉEL (06/09/2026, §45).
 *
 * PAT (fine-grained personal access token), jamais une GitHub App — choix
 * délibéré : une App exigerait l'Owner enregistre une App GitHub (client
 * id/secret + installation) avant que ce connecteur soit utilisable, alors
 * qu'un PAT permet une connexion en UN champ, aujourd'hui, sans dépendance
 * externe supplémentaire — cohérent avec §43 "Do not stop after documenting
 * adapters" et §94 "no future-work escape". Le token est chiffré (AES-256-GCM,
 * src/lib/crypto.ts, identique à Integration) avant stockage dans
 * PlatformIntegration (Owner, jamais scopé par storeId — voir schema.prisma).
 *
 * §"NO FAKE CONNECTOR" : AUCUNE lecture n'affiche un dépôt/PR/commit sans un
 * appel RÉEL à api.github.com avec le token stocké — jamais une donnée mise
 * en cache présentée comme fraîche sans re-vérification.
 */

const GITHUB_API = "https://api.github.com";
export const GITHUB_PROVIDER_KEY = "github";

interface GithubCredentials {
  token: string;
  repoFullName: string; // "owner/repo" — le dépôt cible unique de ce connecteur (celui d'OnDeal lui-même)
}

export class GithubConnectorError extends Error {}

async function githubFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

async function getCredentials(): Promise<GithubCredentials | null> {
  const row = await prisma.platformIntegration.findUnique({ where: { provider: GITHUB_PROVIDER_KEY } });
  if (!row?.encryptedCredentials) return null;
  return decryptJson<GithubCredentials>(row.encryptedCredentials);
}

/** Appelé UNIQUEMENT depuis la route /connect — vérifie RÉELLEMENT le token (GET /user + accès au dépôt) AVANT de le persister, jamais un secret non testé enregistré à l'aveugle. */
export async function connectGithub(token: string, repoFullName: string, connectedByUserId: string): Promise<{ scopes: string[]; login: string }> {
  const userRes = await githubFetch(token, "/user");
  if (!userRes.ok) throw new GithubConnectorError(`Jeton invalide — l'API GitHub a répondu ${userRes.status}.`);
  const scopesHeader = userRes.headers.get("x-oauth-scopes") ?? "";
  const login = (await userRes.json()).login as string;

  const repoRes = await githubFetch(token, `/repos/${repoFullName}`);
  if (!repoRes.ok) throw new GithubConnectorError(`Jeton valide mais dépôt "${repoFullName}" inaccessible (réponse ${repoRes.status}) — vérifiez le nom du dépôt et les scopes du jeton.`);

  const scopes = scopesHeader.split(",").map((s) => s.trim()).filter(Boolean);
  await prisma.platformIntegration.upsert({
    where: { provider: GITHUB_PROVIDER_KEY },
    create: {
      provider: GITHUB_PROVIDER_KEY,
      status: "CONNECTED",
      encryptedCredentials: encryptJson({ token, repoFullName }),
      scopesJson: JSON.stringify(scopes),
      connectedByUserId,
      lastHealthCheckAt: new Date(),
    },
    update: {
      status: "CONNECTED",
      encryptedCredentials: encryptJson({ token, repoFullName }),
      scopesJson: JSON.stringify(scopes),
      connectedByUserId,
      lastHealthCheckAt: new Date(),
      lastError: null,
    },
  });
  return { scopes, login };
}

export async function disconnectGithub(): Promise<void> {
  await prisma.platformIntegration.updateMany({ where: { provider: GITHUB_PROVIDER_KEY }, data: { status: "NOT_CONNECTED", encryptedCredentials: null, scopesJson: null } });
}

export interface GithubHealth {
  status: "CONNECTED" | "NOT_CONNECTED" | "ERROR";
  detail: string;
  repoFullName: string | null;
  scopes: string[] | null;
  lastHealthCheckAt: string | null;
}

/** Re-vérifie RÉELLEMENT (nouvel appel API) — jamais une lecture de la colonne `status` sans confirmation fraîche au-delà de sa fenêtre de fraîcheur naturelle (chaque appel de cette fonction EST la vérification). */
export async function githubHealthCheck(): Promise<GithubHealth> {
  const creds = await getCredentials();
  if (!creds) return { status: "NOT_CONNECTED", detail: "Aucun jeton GitHub configuré.", repoFullName: null, scopes: null, lastHealthCheckAt: null };

  const res = await githubFetch(creds.token, `/repos/${creds.repoFullName}`);
  const now = new Date();
  if (!res.ok) {
    await prisma.platformIntegration.update({ where: { provider: GITHUB_PROVIDER_KEY }, data: { status: "ERROR", lastError: `HTTP ${res.status}`, lastHealthCheckAt: now } });
    return { status: "ERROR", detail: `L'API GitHub a répondu ${res.status} pour "${creds.repoFullName}".`, repoFullName: creds.repoFullName, scopes: null, lastHealthCheckAt: now.toISOString() };
  }
  await prisma.platformIntegration.update({ where: { provider: GITHUB_PROVIDER_KEY }, data: { status: "CONNECTED", lastError: null, lastHealthCheckAt: now } });
  const row = await prisma.platformIntegration.findUnique({ where: { provider: GITHUB_PROVIDER_KEY } });
  return { status: "CONNECTED", detail: "Connexion réelle vérifiée à l'instant.", repoFullName: creds.repoFullName, scopes: row?.scopesJson ? JSON.parse(row.scopesJson) : null, lastHealthCheckAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Lectures réelles (§45 "read repo, search code, commit, branches, PR, issues, CI")
// ---------------------------------------------------------------------------

async function requireCredentials(): Promise<GithubCredentials> {
  const creds = await getCredentials();
  if (!creds) throw new GithubConnectorError("Connecteur GitHub non connecté — Owner : AI LAB → CONNECTORS → GitHub → Connect.");
  return creds;
}

export async function getRepoInfo() {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/repos/${repoFullName}`);
  if (!res.ok) throw new GithubConnectorError(`Lecture du dépôt échouée (${res.status}).`);
  return res.json();
}

export async function searchCode(query: string) {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/search/code?q=${encodeURIComponent(`${query} repo:${repoFullName}`)}`);
  if (!res.ok) throw new GithubConnectorError(`Recherche de code échouée (${res.status}).`);
  return res.json();
}

export async function listCommits(limit = 20) {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/repos/${repoFullName}/commits?per_page=${Math.min(limit, 100)}`);
  if (!res.ok) throw new GithubConnectorError(`Lecture des commits échouée (${res.status}).`);
  return res.json();
}

export async function listBranches() {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/repos/${repoFullName}/branches`);
  if (!res.ok) throw new GithubConnectorError(`Lecture des branches échouée (${res.status}).`);
  return res.json();
}

export async function listPullRequests(state: "open" | "closed" | "all" = "open") {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/repos/${repoFullName}/pulls?state=${state}`);
  if (!res.ok) throw new GithubConnectorError(`Lecture des PR échouée (${res.status}).`);
  return res.json();
}

export async function listIssues(state: "open" | "closed" | "all" = "open") {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/repos/${repoFullName}/issues?state=${state}`);
  if (!res.ok) throw new GithubConnectorError(`Lecture des issues échouée (${res.status}).`);
  return res.json();
}

export async function listWorkflowRuns(workflowFileName: string, limit = 10) {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/repos/${repoFullName}/actions/workflows/${workflowFileName}/runs?per_page=${Math.min(limit, 50)}`);
  if (!res.ok) throw new GithubConnectorError(`Lecture des runs Actions échouée (${res.status}).`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Écritures Owner-gated (§45 "create branch, create PR, trigger workflow") —
// l'appelant (route API) DOIT avoir déjà passé requireCapabilityWithStepUp
// avant d'invoquer une de ces fonctions ; ce fichier ne le revérifie pas
// lui-même (séparation des responsabilités : policy côté route, exécution ici).
// ---------------------------------------------------------------------------

export async function createBranch(branchName: string, fromBranch = "master") {
  const { token, repoFullName } = await requireCredentials();
  const refRes = await githubFetch(token, `/repos/${repoFullName}/git/ref/heads/${fromBranch}`);
  if (!refRes.ok) throw new GithubConnectorError(`Lecture de la branche source "${fromBranch}" échouée (${refRes.status}).`);
  const sha = (await refRes.json()).object.sha as string;
  const res = await githubFetch(token, `/repos/${repoFullName}/git/refs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
  });
  if (!res.ok) throw new GithubConnectorError(`Création de branche échouée (${res.status}).`);
  return res.json();
}

export async function createPullRequest(params: { title: string; head: string; base: string; body: string }) {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/repos/${repoFullName}/pulls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new GithubConnectorError(`Création de PR échouée (${res.status}).`);
  return res.json();
}

function encodeContentPath(pathInRepo: string): string {
  return pathInRepo.split("/").map(encodeURIComponent).join("/");
}

/**
 * §61-65 "System Evolution Console" — lit le `sha` RÉEL d'un fichier sur une
 * branche donnée (Contents API), nécessaire pour un PUT/DELETE ultérieur sur
 * ce même fichier (l'API GitHub refuse une écriture sans le sha courant,
 * garde native contre un écrasement concurrent). `null` si le fichier
 * n'existe pas encore sur cette branche (cas normal pour un fichier créé par
 * la mission) — jamais une exception pour ce cas attendu.
 */
export async function getFileShaOnBranch(pathInRepo: string, branch: string): Promise<string | null> {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/repos/${repoFullName}/contents/${encodeContentPath(pathInRepo)}?ref=${encodeURIComponent(branch)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new GithubConnectorError(`Lecture du fichier "${pathInRepo}" (branche "${branch}") échouée (${res.status}).`);
  const body = (await res.json()) as { sha: string };
  return body.sha;
}

/**
 * Écrit (crée ou remplace) RÉELLEMENT le contenu d'UN fichier sur UNE branche
 * via l'API Contents — jamais un `git push` local (ce process n'a aucune
 * copie du dépôt réel avec des credentials configurées). `sha` obligatoire
 * pour remplacer un fichier existant (voir getFileShaOnBranch), absent pour
 * une création.
 */
export async function putFileOnBranch(pathInRepo: string, branch: string, content: Buffer, message: string, sha?: string | null): Promise<void> {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/repos/${repoFullName}/contents/${encodeContentPath(pathInRepo)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, content: content.toString("base64"), branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GithubConnectorError(`Écriture du fichier "${pathInRepo}" sur la branche "${branch}" échouée (${res.status}). ${detail}`.trim());
  }
}

/** Supprime RÉELLEMENT un fichier sur une branche via l'API Contents — `sha` obligatoire (voir getFileShaOnBranch), jamais une suppression à l'aveugle sans connaître le contenu actuel. */
export async function deleteFileOnBranch(pathInRepo: string, branch: string, message: string, sha: string): Promise<void> {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/repos/${repoFullName}/contents/${encodeContentPath(pathInRepo)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, sha, branch }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GithubConnectorError(`Suppression du fichier "${pathInRepo}" sur la branche "${branch}" échouée (${res.status}). ${detail}`.trim());
  }
}

/**
 * §33 "durable runner" — déclenche RÉELLEMENT le workflow GitHub Actions
 * (.github/workflows/ai-lab-mission.yml) via workflow_dispatch. C'est le
 * mécanisme qui remplace "aucun terminal manuel requis" : cette fonction,
 * appelée depuis une route API, EST le clic Owner qui démarre le worker
 * durable — jamais un script à lancer soi-même en dev.
 */
export async function dispatchWorkflow(workflowFileName: string, ref: string, inputs: Record<string, string>) {
  const { token, repoFullName } = await requireCredentials();
  const res = await githubFetch(token, `/repos/${repoFullName}/actions/workflows/${workflowFileName}/dispatches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref, inputs }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GithubConnectorError(`Déclenchement du workflow "${workflowFileName}" échoué (${res.status}). ${detail}`.trim());
  }
}
