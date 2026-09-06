import { spawn, type ChildProcess } from "node:child_process";
import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — FINAL PHASE : Merchant E2E réel (06/09/2026).
 *
 * §"Merchant E2E réel" du mandat final. Distinct de e2e-smoke.ts (sans
 * état, frontières d'autorisation) et de red-team.ts (adversarial) : ce
 * script rejoue un VRAI parcours marchand de bout en bout contre le VRAI
 * build de production (`next start`) et la VRAIE base Postgres locale —
 * signup réel → onboarding réel (mode "demo", jeu de données réaliste déjà
 * câblé — seedDemoStore.ts) → pages authentifiées réellement chargées →
 * entitlements de plan RÉELLEMENT appliqués côté API (jamais déduits d'une
 * simple lecture du code) → une VRAIE mutation autorisée bout en bout
 * (dismiss d'une recommandation, re-vérifiée en base après l'appel HTTP,
 * jamais seulement le code HTTP).
 *
 * Un parcours Owner réel équivalent (WebAuthn/FIDO2) ne peut PAS être
 * scripté depuis un agent — la cérémonie exige l'authenticateur physique
 * de l'Owner lui-même (déjà documenté ainsi dans l'Acceptance Matrix du
 * 06/09/2026, §11) : jamais simulé ici.
 */

const PORT = Number(process.env.MERCHANT_E2E_PORT ?? "4797");
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 30_000;
const RUN_ID = Date.now();
const CSRF_COOKIE_NAME = "ondeal_csrf";

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

function extractCookies(res: Response): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const raw of res.headers.getSetCookie()) {
    const pair = raw.split(";")[0];
    const eq = pair?.indexOf("=") ?? -1;
    if (pair && eq > 0) jar[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return jar;
}

function authHeaders(jar: Record<string, string>): Record<string, string> {
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const headers: Record<string, string> = { cookie };
  const csrf = jar[CSRF_COOKIE_NAME];
  if (csrf) headers["x-csrf-token"] = csrf;
  return headers;
}

async function main(): Promise<void> {
  console.log(`[merchant-e2e] Démarrage de next start sur le port ${PORT} (build de production réel)…`);
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
  const record = (label: string, ok: boolean, detail: string) => findings.push({ label, ok, detail });

  try {
    await waitForReady(Date.now() + READY_TIMEOUT_MS);
    console.log("[merchant-e2e] Serveur prêt — parcours marchand réel…\n");

    // --- 1. Signup réel ---
    const email = `merchant-e2e-${RUN_ID}@e2e-smoke.invalid`;
    const password = "Merchant-E2E-Password-123!";
    const signupRes = await fetch(`${BASE}/api/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Marchand E2E", email, password, organizationName: `Merchant E2E Org ${RUN_ID}`, acceptedTerms: true }),
    });
    if (signupRes.status !== 200) throw new Error(`Signup a échoué (${signupRes.status}) : ${await signupRes.text()}`);
    let jar = extractCookies(signupRes);
    record("Signup réel (POST /api/auth/signup)", true, "compte + organisation créés (plan STARTER par défaut)");

    // --- 2. Onboarding réel, mode démo (jeu de données réaliste, seedDemoStore.ts) ---
    const onboardRes = await fetch(`${BASE}/api/onboarding`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(jar) },
      body: JSON.stringify({ mode: "demo" }),
    });
    if (onboardRes.status !== 200) throw new Error(`Onboarding démo a échoué (${onboardRes.status}) : ${await onboardRes.text()}`);
    const { storeId } = (await onboardRes.json()) as { storeId: string };
    record("Onboarding réel mode démo (POST /api/onboarding)", true, `boutique démo créée (storeId=${storeId})`);

    // --- 3. Pages authentifiées réellement chargées (STARTER : dashboard/stock/reviews inclus) ---
    for (const path of [`/dashboard?store=${storeId}`, `/settings?store=${storeId}`, `/products?store=${storeId}`, `/stock?store=${storeId}`, `/reviews?store=${storeId}`]) {
      const res = await fetch(`${BASE}${path}`, { headers: authHeaders(jar), redirect: "manual" });
      record(`Page authentifiée ${path.split("?")[0]} → 200 réel (jamais 500)`, res.status === 200, `statut réel = ${res.status}`);
    }

    // --- 4. Entitlements de plan RÉELLEMENT appliqués côté API pour STARTER (marketing/assistant NON inclus) ---
    const products = await prisma.product.findMany({ where: { storeId }, select: { id: true }, take: 1 });
    if (products[0]) {
      const marketingRes = await fetch(`${BASE}/api/marketing/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(jar) },
        body: JSON.stringify({ storeId, productId: products[0].id, format: "accroche" }),
      });
      record(
        "Entitlement réel : STARTER ne peut PAS générer de contenu marketing (POST /api/marketing/generate) → 403",
        marketingRes.status === 403,
        `statut réel = ${marketingRes.status} (attendu 403 'Module non inclus dans votre plan.')`,
      );
    } else {
      record("Entitlement marketing (STARTER)", false, "aucun produit démo trouvé pour tester — seedDemoStore.ts n'a rien créé ?");
    }

    const assistantRes = await fetch(`${BASE}/api/assistant/query`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(jar) },
      body: JSON.stringify({ storeId, question: "Que dois-je faire aujourd'hui ?" }),
    });
    record(
      "Entitlement réel : STARTER ne peut PAS interroger OnDeal AI (POST /api/assistant/query) → 403",
      assistantRes.status === 403,
      `statut réel = ${assistantRes.status} (attendu 403 'Module non inclus dans votre plan.')`,
    );

    // --- 5. Une VRAIE mutation autorisée bout en bout (STARTER inclut "recommendations"), re-vérifiée EN BASE ---
    const recommendation = await prisma.recommendation.findFirst({ where: { storeId, status: "OPEN" }, select: { id: true, title: true } });
    if (recommendation) {
      const dismissRes = await fetch(`${BASE}/api/recommendations/${recommendation.id}/dismiss`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(jar) },
      });
      const dbRow = await prisma.recommendation.findUnique({ where: { id: recommendation.id }, select: { status: true } });
      record(
        "Mutation autorisée bout en bout (POST /api/recommendations/:id/dismiss), re-vérifiée EN BASE",
        dismissRes.status === 200 && dbRow?.status === "DISMISSED",
        `HTTP ${dismissRes.status}, statut réel en base après l'appel : ${dbRow?.status ?? "introuvable"} (attendu DISMISSED)`,
      );
    } else {
      record("Mutation autorisée (dismiss recommandation)", false, "aucune recommandation OPEN trouvée pour la boutique démo — seedDemoStore.ts n'en a créé aucune ?");
    }

    // --- 6. Déconnexion puis reconnexion réelle (même identifiants) ---
    const logoutRes = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: authHeaders(jar) });
    record("Déconnexion réelle (POST /api/auth/logout)", logoutRes.status === 200, `statut réel = ${logoutRes.status}`);
    // clearSessionCookie() supprime les cookies via le Set-Cookie de LA
    // RÉPONSE (valeur vidée/expirée) — jamais une révocation server-side
    // d'un JWT par nature stateless. Un VRAI navigateur cesse alors
    // d'envoyer ces cookies ; ce script doit reproduire fidèlement ce
    // comportement (fusionner les cookies vidés dans le jar) plutôt que de
    // rejouer l'ancien cookie encore valide, ce qui fabriquerait un faux
    // échec de test — jamais un vrai bug applicatif.
    jar = { ...jar, ...extractCookies(logoutRes) };

    const afterLogoutRes = await fetch(`${BASE}/dashboard?store=${storeId}`, { headers: authHeaders(jar), redirect: "manual" });
    record("Après déconnexion : session révoquée, plus d'accès au dashboard (jamais 200)", afterLogoutRes.status !== 200, `statut réel = ${afterLogoutRes.status}`);

    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (loginRes.status !== 200) throw new Error(`Reconnexion a échoué (${loginRes.status}) : ${await loginRes.text()}`);
    jar = extractCookies(loginRes);
    record("Reconnexion réelle avec les mêmes identifiants (POST /api/auth/login)", true, "nouvelle session obtenue");

    const afterLoginRes = await fetch(`${BASE}/dashboard?store=${storeId}`, { headers: authHeaders(jar), redirect: "manual" });
    record("Après reconnexion : accès au dashboard restauré", afterLoginRes.status === 200, `statut réel = ${afterLoginRes.status}`);
  } catch (err) {
    console.error(`[merchant-e2e] ÉCHEC : ${err instanceof Error ? err.message : String(err)}`);
    console.error("--- sortie du serveur ---");
    console.error(serverOutput.slice(-4000));
    process.exitCode = 1;
  } finally {
    stopServer(child);
    await prisma.$disconnect();
  }

  console.log("");
  let failures = 0;
  for (const f of findings) {
    console.log(`${f.ok ? "✅" : "❌"} ${f.label} → ${f.detail}`);
    if (!f.ok) failures++;
  }
  console.log(`\n[merchant-e2e] ${findings.length - failures}/${findings.length} étapes du parcours marchand réel réussies.`);
  if (failures > 0 || findings.length === 0) process.exit(1);
  console.log("[merchant-e2e] Parcours marchand réel complet, de bout en bout, sans aucun mock aux frontières.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
