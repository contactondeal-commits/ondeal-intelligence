import { spawn, type ChildProcess } from "node:child_process";

/**
 * ONDEAL AI CORE — §204 "Acceptance Matrix complète + E2E + déploiement" (06/09/2026).
 *
 * Premier VRAI test E2E de ce dépôt : contrairement aux 510 tests unitaires/
 * intégration (`npx vitest run`), qui mockent systématiquement les
 * frontières externes (Prisma, fetch, providers, navigateur), ce script
 * démarre le BUILD DE PRODUCTION RÉEL (`next start`, exactement le binaire
 * que Vercel exécute) contre la VRAIE base Postgres locale (`ondeal_verify`,
 * migrations déjà appliquées — voir DATABASE_URL, .env) et vérifie, par de
 * VRAIES requêtes HTTP, que l'application démarre et applique réellement ses
 * frontières d'autorisation — jamais un mock qui pourrait masquer une
 * régression d'intégration réelle (route mal montée, middleware cassé,
 * migration manquante).
 *
 * Portée délibérément limitée à des vérifications SANS ÉTAT (pas de
 * création de compte, pas de mutation) — un smoke test de démarrage/
 * autorisation, pas une suite fonctionnelle complète (celle-ci reste
 * `npx vitest run`, qui couvre la LOGIQUE ; ce script couvre le CÂBLAGE).
 *
 * Usage : `npm run e2e:smoke` (prérequis : `npm run build` déjà exécuté,
 * Postgres local accessible via DATABASE_URL).
 */

const PORT = Number(process.env.E2E_SMOKE_PORT ?? "4799");
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 30_000;

interface Check {
  label: string;
  method?: "GET" | "POST";
  path: string;
  body?: unknown;
  /** Statuts HTTP acceptés — le premier qui matche est un succès ; aucun ne matchant = échec rapporté. */
  expectStatus: number[];
}

// Chaque route ci-dessous a une frontière d'autorisation CONNUE et FIXE côté
// code (requireCapability*/requireStoreAccess/redirection page) — ce script
// verrouille cette frontière au niveau HTTP réel, jamais un statut supposé.
const CHECKS: Check[] = [
  { label: "Page publique /login", path: "/login", expectStatus: [200] },
  { label: "Page publique /signup", path: "/signup", expectStatus: [200] },
  { label: "Page publique /cgu", path: "/cgu", expectStatus: [200] },
  { label: "Page publique /privacy", path: "/privacy", expectStatus: [200] },
  { label: "Racine / (redirection vers /login ou /dashboard, jamais 500)", path: "/", expectStatus: [200, 307, 308] },
  { label: "/pricing (peut rediriger selon session)", path: "/pricing", expectStatus: [200, 307, 308] },
  { label: "/owner-auth (page WebAuthn, jamais 500)", path: "/owner-auth", expectStatus: [200] },
  { label: "/ai-lab sans session Owner → redirection (jamais 200 ni 500)", path: "/ai-lab", expectStatus: [307, 308] },
  { label: "Route inconnue → 404 réel", path: "/does-not-exist-e2e-smoke", expectStatus: [404] },

  { label: "GET /api/ai-lab/missions sans session → 403 (jamais un flux/liste ouvert)", path: "/api/ai-lab/missions", expectStatus: [403] },
  { label: "GET /api/ai-lab/experiments sans session → 403", path: "/api/ai-lab/experiments", expectStatus: [403] },
  { label: "GET /api/ai-lab/evolution/proposals sans session → 403", path: "/api/ai-lab/evolution/proposals", expectStatus: [403] },
  { label: "GET /api/ai-lab/agents sans session → 403", path: "/api/ai-lab/agents", expectStatus: [403] },
  { label: "GET /api/ai-lab/memory sans session → 403", path: "/api/ai-lab/memory", expectStatus: [403] },
  { label: "GET /api/ai-lab/tools sans session → 403 (importe attachments/parse.ts — a régressé en 500 en production, cf. correctif pdf-parse/mammoth/xlsx dynamiques)", path: "/api/ai-lab/tools", expectStatus: [403] },
  { label: "GET /api/ai-lab/attachments sans session → 403 (même import attachments/parse.ts)", path: "/api/ai-lab/attachments", expectStatus: [403] },
  { label: "GET /api/ai-lab/connectors sans session → 403", path: "/api/ai-lab/connectors", expectStatus: [403] },
  { label: "GET /api/ai-lab/models sans session → 403", path: "/api/ai-lab/models", expectStatus: [403] },
  { label: "GET /api/ai-lab/outcomes sans session → 403 (Outcome/ROI Engine)", path: "/api/ai-lab/outcomes", expectStatus: [403] },
  { label: "GET /api/ai-lab/missions/x/stream sans session → 403 (jamais un flux SSE ouvert)", path: "/api/ai-lab/missions/e2e-smoke-fake-id/stream", expectStatus: [403] },
  { label: "GET /api/owner/sessions sans session → 401", path: "/api/owner/sessions", expectStatus: [401] },
  { label: "GET /api/cron/sync sans secret → 401", path: "/api/cron/sync", expectStatus: [401] },
  { label: "GET /api/ai-lab/images (méthode non supportée) → 405, jamais 500", path: "/api/ai-lab/images", expectStatus: [405] },

  { label: "POST /api/ai-lab/images sans session → 403 (jamais une génération réelle sans auth)", method: "POST", path: "/api/ai-lab/images", body: { prompt: "smoke test" }, expectStatus: [403] },
  { label: "POST /api/ai-lab/experiments sans session → 403", method: "POST", path: "/api/ai-lab/experiments", body: {}, expectStatus: [403] },
];

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
  // Même discipline que coder/preview.ts::stopPreviewServer : `next start`
  // engendre un `next-server` réel via un process intermédiaire — cibler le
  // GROUPE entier, jamais uniquement le PID de tête, pour ne jamais laisser
  // un next-server orphelin toujours lié au port.
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

async function runCheck(check: Check): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${BASE}${check.path}`, {
      method: check.method ?? "GET",
      redirect: "manual", // on veut voir le VRAI code 30x, jamais suivre silencieusement une redirection
      headers: check.body ? { "content-type": "application/json" } : undefined,
      body: check.body ? JSON.stringify(check.body) : undefined,
    });
    const ok = check.expectStatus.includes(res.status);
    return { ok, detail: ok ? `${res.status}` : `${res.status} (attendu : ${check.expectStatus.join(" ou ")})` };
  } catch (err) {
    return { ok: false, detail: `erreur réseau : ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function main(): Promise<void> {
  console.log(`[e2e-smoke] Démarrage de next start sur le port ${PORT} (build de production réel)…`);
  const child = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let serverOutput = "";
  child.stdout?.on("data", (c: Buffer) => (serverOutput += c.toString("utf8")));
  child.stderr?.on("data", (c: Buffer) => (serverOutput += c.toString("utf8")));

  let failures = 0;
  try {
    await waitForReady(Date.now() + READY_TIMEOUT_MS);
    console.log("[e2e-smoke] Serveur prêt — exécution des vérifications réelles…\n");

    for (const check of CHECKS) {
      const result = await runCheck(check);
      console.log(`${result.ok ? "✅" : "❌"} ${check.label} → ${result.detail}`);
      if (!result.ok) failures++;
    }
  } catch (err) {
    console.error(`[e2e-smoke] ÉCHEC AU DÉMARRAGE : ${err instanceof Error ? err.message : String(err)}`);
    console.error("--- sortie du serveur ---");
    console.error(serverOutput.slice(-4000));
    failures++;
  } finally {
    stopServer(child);
  }

  console.log(`\n[e2e-smoke] ${CHECKS.length - failures}/${CHECKS.length} vérifications réussies.`);
  if (failures > 0) {
    console.error(`[e2e-smoke] ${failures} échec(s) — voir ❌ ci-dessus.`);
    process.exit(1);
  }
  console.log("[e2e-smoke] Toutes les vérifications sont passées — build de production réellement fonctionnel contre la base réelle.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
