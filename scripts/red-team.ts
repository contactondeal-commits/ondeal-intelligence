import { spawn, type ChildProcess } from "node:child_process";

/**
 * ONDEAL AI CORE — FINAL PHASE : Security / Red-Team (06/09/2026).
 *
 * §"sécurité/red-team" du mandat final — jusqu'ici totalement absent du
 * dépôt (aucun script d'attaque réel, seulement des affirmations de
 * conformité dans des rapports). Ce script est la preuve inverse d'un
 * audit déclaratif : il démarre le VRAI build de production (même
 * discipline que scripts/e2e-smoke.ts) contre la VRAIE base Postgres
 * locale, crée deux VRAIS comptes/organisations/boutiques via les routes
 * publiques réelles (signup, onboarding), puis tente RÉELLEMENT les
 * attaques suivantes — jamais une simulation, jamais un "devrait
 * fonctionner" sans appel réel :
 *
 *   1. IDOR Merchant Plane : le compte A (aucune appartenance à
 *      l'organisation de B) tente d'écrire les hypothèses de coût de la
 *      boutique de B via POST /api/stores/cost-defaults — DOIT échouer
 *      (403), sinon c'est une VRAIE faille d'isolation multi-tenant.
 *   2. Control Plane isolation ("STORE ADMIN ≠ ONDEAL OWNER", §13) : le
 *      compte A, Role.OWNER légitime de SA PROPRE organisation (donc un
 *      rôle métier élevé), tente d'invoquer une route SYSTEM_CODER
 *      (POST /api/coder-missions) — DOIT échouer (403) indépendamment de
 *      son rôle Membership.
 *   3. Rate limiting anti-brute-force réel sur /api/auth/login : 12
 *      tentatives avec un mauvais mot de passe pour le MÊME email — la
 *      limite documentée (10/15min par email, voir login/route.ts) DOIT
 *      se déclencher (429) avant la 12e tentative.
 *
 * Chaque échec est un VRAI défaut de sécurité à corriger avant tout
 * déploiement — ce script sort avec un code non-zéro si une seule
 * attaque réussit là où elle devrait échouer.
 */

const PORT = Number(process.env.RED_TEAM_PORT ?? "4798");
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 30_000;
const RUN_ID = Date.now();

interface Finding {
  label: string;
  ok: boolean;
  detail: string;
}

async function waitForReady(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return;
    } catch {
      // pas encore prêt — retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Le serveur next start n'a pas répondu dans les ${READY_TIMEOUT_MS}ms impartis.`);
}

function stopServer(child: ChildProcess): void {
  if (typeof child.pid === "number") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // groupe déjà disparu ou non supporté — repli ci-dessous
    }
  }
  child.kill("SIGKILL");
}

const CSRF_COOKIE_NAME = "ondeal_csrf";

/**
 * Extrait TOUS les cookies d'une réponse — jamais un jar de librairie
 * externe, juste le nécessaire réel ici. `Response.headers.get("set-cookie")`
 * fusionne silencieusement plusieurs en-têtes Set-Cookie en une seule chaîne
 * illisible (le middleware pose ondeal_session ET ondeal_csrf en deux
 * en-têtes séparés, voir auth.ts::setSessionCookie) — `getSetCookie()` est
 * la seule API fetch qui les restitue séparément.
 */
function extractCookies(res: Response): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const raw of res.headers.getSetCookie()) {
    const pair = raw.split(";")[0];
    const eq = pair?.indexOf("=") ?? -1;
    if (pair && eq > 0) jar[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return jar;
}

/** Reconstruit l'en-tête Cookie: à rejouer, plus le jeton anti-CSRF (double soumission, voir middleware.ts) attendu en en-tête X-CSRF-Token sur toute requête mutative. */
function authHeaders(jar: Record<string, string>): Record<string, string> {
  const cookie = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const headers: Record<string, string> = { cookie };
  const csrf = jar[CSRF_COOKIE_NAME];
  if (csrf) headers["x-csrf-token"] = csrf;
  return headers;
}

async function signupAndOnboard(label: string): Promise<{ jar: Record<string, string>; storeId: string } | { error: string }> {
  const email = `redteam-${label}-${RUN_ID}@e2e-smoke.invalid`;
  const signupRes = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `Red Team ${label}`,
      email,
      password: "Red-Team-Password-123!",
      organizationName: `Red Team Org ${label} ${RUN_ID}`,
      acceptedTerms: true,
    }),
  });
  if (signupRes.status !== 200) return { error: `signup a échoué (${signupRes.status}) : ${await signupRes.text()}` };
  const jar = extractCookies(signupRes);
  if (!jar.ondeal_session) return { error: "signup n'a renvoyé aucun cookie de session." };
  if (!jar[CSRF_COOKIE_NAME]) return { error: "signup n'a renvoyé aucun cookie anti-CSRF (ondeal_csrf)." };

  const onboardRes = await fetch(`${BASE}/api/onboarding`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(jar) },
    body: JSON.stringify({ mode: "real", storeName: `Boutique Red Team ${label}` }),
  });
  if (onboardRes.status !== 200) return { error: `onboarding a échoué (${onboardRes.status}) : ${await onboardRes.text()}` };
  const { storeId } = (await onboardRes.json()) as { storeId: string };
  return { jar, storeId };
}

async function main(): Promise<void> {
  console.log(`[red-team] Démarrage de next start sur le port ${PORT} (build de production réel)…`);
  const child = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let serverOutput = "";
  child.stdout?.on("data", (c: Buffer) => (serverOutput += c.toString("utf8")));
  child.stderr?.on("data", (c: Buffer) => (serverOutput += c.toString("utf8")));

  const findings: Finding[] = [];

  try {
    await waitForReady(Date.now() + READY_TIMEOUT_MS);
    console.log("[red-team] Serveur prêt — création de deux comptes réels (A et B)…\n");

    const a = await signupAndOnboard("a");
    const b = await signupAndOnboard("b");
    if ("error" in a) throw new Error(`Compte A : ${a.error}`);
    if ("error" in b) throw new Error(`Compte B : ${b.error}`);

    // --- Attaque 1 : IDOR Merchant Plane (A écrit sur la boutique de B) ---
    const idorRes = await fetch(`${BASE}/api/stores/cost-defaults`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(a.jar) },
      body: JSON.stringify({ storeId: b.storeId, defaultShippingCost: 999, defaultPaymentFeesRate: 0.5 }),
    });
    findings.push({
      label: "IDOR Merchant Plane : compte A écrit sur la boutique de B (POST /api/stores/cost-defaults)",
      ok: idorRes.status === 403,
      detail: `statut réel = ${idorRes.status} (attendu 403)`,
    });

    // --- Attaque 2 : Control Plane isolation (STORE OWNER ≠ ONDEAL OWNER) ---
    const controlPlaneRes = await fetch(`${BASE}/api/coder-missions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(a.jar) },
      body: JSON.stringify({ goal: "red-team probe — ne doit jamais s'exécuter", storeId: a.storeId }),
    });
    findings.push({
      label: "Control Plane isolation : Role.OWNER métier (compte A) tente SYSTEM_CODER (POST /api/coder-missions)",
      ok: controlPlaneRes.status === 403,
      detail: `statut réel = ${controlPlaneRes.status} (attendu 403, indépendamment du rôle Membership)`,
    });

    // --- Attaque 3 : rate limiting anti-brute-force sur /api/auth/login ---
    const bruteEmail = `redteam-bruteforce-${RUN_ID}@e2e-smoke.invalid`;
    let sawRateLimit = false;
    let lastStatus = 0;
    for (let attempt = 1; attempt <= 12; attempt++) {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: bruteEmail, password: `wrong-password-${attempt}` }),
      });
      lastStatus = res.status;
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
    }
    findings.push({
      label: "Rate limiting anti-brute-force : 12 tentatives de mot de passe erroné sur /api/auth/login (même email)",
      ok: sawRateLimit,
      detail: sawRateLimit ? "429 déclenché avant la 12e tentative, comme attendu" : `jamais de 429 observé en 12 tentatives (dernier statut : ${lastStatus}) — LIMITE NON APPLIQUÉE`,
    });
  } catch (err) {
    console.error(`[red-team] ÉCHEC AU DÉMARRAGE OU PENDANT LA PRÉPARATION : ${err instanceof Error ? err.message : String(err)}`);
    console.error("--- sortie du serveur ---");
    console.error(serverOutput.slice(-4000));
    process.exitCode = 1;
  } finally {
    stopServer(child);
  }

  console.log("");
  let failures = 0;
  for (const f of findings) {
    console.log(`${f.ok ? "✅" : "🚨"} ${f.label} → ${f.detail}`);
    if (!f.ok) failures++;
  }
  console.log(`\n[red-team] ${findings.length - failures}/${findings.length} défense(s) tiennent face à une attaque réelle.`);
  if (failures > 0) {
    console.error(`[red-team] ${failures} FAILLE(S) RÉELLE(S) DÉTECTÉE(S) — voir 🚨 ci-dessus. Ne jamais déployer tel quel.`);
    process.exit(1);
  }
  if (findings.length === 0) process.exit(1); // aucune attaque n'a pu être tentée = pas une preuve de sécurité, un échec de préparation
  console.log("[red-team] Aucune faille détectée par ces attaques réelles.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
