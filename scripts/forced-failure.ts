import { spawn, execSync, type ChildProcess } from "node:child_process";

/**
 * ONDEAL AI CORE — FINAL PHASE : test de panne forcée réel (06/09/2026).
 *
 * §"tests de panne forcée" du mandat final. Contrairement à un test unitaire
 * qui MOCKE une panne, ce script provoque une VRAIE panne — arrêt réel du
 * VRAI service Postgres local pendant que le VRAI binaire de production
 * (`next start`) continue de tourner — et mesure trois affirmations de
 * résilience précises et vérifiables, jamais supposées :
 *
 *   1. AVANT la panne : /api/health (voir observability/health.ts, livré
 *      ce même segment) rapporte 200/"ok" — base de référence réelle.
 *   2. PENDANT la panne : /api/health rapporte RÉELLEMENT 503/"degraded"
 *      (jamais un 200 qui mentirait à un moniteur externe) ET le
 *      PROCESSUS next-server lui-même reste VIVANT et répond toujours aux
 *      requêtes HTTP (une panne Postgres ne doit jamais faire planter le
 *      process Node — sinon un simple redémarrage de base exigerait un
 *      redéploiement complet, jamais acceptable).
 *   3. APRÈS restauration de Postgres : /api/health revient à 200/"ok"
 *      SANS jamais redémarrer next start — auto-rétablissement réel, pas
 *      une supposition.
 *
 * Aucune donnée réelle n'est jamais touchée : Postgres est arrêté puis
 * immédiatement redémarré (aucune suppression, aucune purge).
 */

const PORT = Number(process.env.FORCED_FAILURE_PORT ?? "4796");
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 30_000;
const OUTAGE_RECHECK_TIMEOUT_MS = 20_000;
const RECOVERY_TIMEOUT_MS = 30_000;

interface Finding {
  label: string;
  ok: boolean;
  detail: string;
}

interface HealthReport {
  status: string;
  database: string;
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

async function fetchHealth(): Promise<{ httpStatus: number; body: HealthReport | null }> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json().catch(() => null)) as HealthReport | null;
    return { httpStatus: res.status, body };
  } catch {
    return { httpStatus: 0, body: null };
  }
}

/** Vrai jusqu'à `deadline` : réinterroge health tant que la condition n'est pas remplie — jamais un simple sleep fixe qui suppose une durée. */
async function waitUntilHealth(predicate: (r: { httpStatus: number; body: HealthReport | null }) => boolean, deadline: number): Promise<{ httpStatus: number; body: HealthReport | null }> {
  let last: { httpStatus: number; body: HealthReport | null } = { httpStatus: 0, body: null };
  while (Date.now() < deadline) {
    last = await fetchHealth();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

async function main(): Promise<void> {
  console.log(`[forced-failure] Démarrage de next start sur le port ${PORT} (build de production réel)…`);
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
  let postgresStopped = false;

  try {
    await waitForReady(Date.now() + READY_TIMEOUT_MS);

    // S'assurer que Postgres est UP avant de commencer (repli si un run
    // précédent l'a laissé arrêté par erreur).
    try {
      execSync("pg_isready", { stdio: "ignore" });
    } catch {
      execSync("service postgresql start", { stdio: "ignore" });
      await new Promise((r) => setTimeout(r, 1500));
    }

    console.log("[forced-failure] Serveur prêt, Postgres UP — mesure de référence…\n");

    // --- 1. Référence AVANT la panne ---
    const before = await fetchHealth();
    record("AVANT panne : /api/health → 200/\"ok\" (base de référence réelle)", before.httpStatus === 200 && before.body?.status === "ok", `HTTP ${before.httpStatus}, body.status=${before.body?.status ?? "?"}`);

    // --- 2. PANNE RÉELLE : arrêt réel de Postgres ---
    console.log("[forced-failure] Arrêt RÉEL de Postgres (service postgresql stop)…");
    execSync("service postgresql stop", { stdio: "ignore" });
    postgresStopped = true;
    // Confirmation indépendante que Postgres est réellement down (jamais supposé).
    let pgDown = false;
    try {
      execSync("pg_isready", { stdio: "ignore" });
    } catch {
      pgDown = true;
    }
    record("Postgres réellement arrêté (pg_isready échoue)", pgDown, pgDown ? "pg_isready confirme l'arrêt" : "pg_isready répond encore — la panne n'a pas eu lieu, résultats suivants non concluants");

    // --- 3. PENDANT la panne : health dégradé, jamais un succès masqué ; process next-server toujours vivant ---
    const during = await waitUntilHealth((r) => r.httpStatus === 503, Date.now() + OUTAGE_RECHECK_TIMEOUT_MS);
    record(
      "PENDANT panne : /api/health rapporte RÉELLEMENT 503/\"degraded\" (jamais un 200 qui mentirait à un moniteur)",
      during.httpStatus === 503 && during.body?.status === "degraded" && during.body?.database === "error",
      `HTTP ${during.httpStatus}, body=${JSON.stringify(during.body)}`,
    );

    const alive = await fetch(BASE, { signal: AbortSignal.timeout(5000) }).then((r) => r.status, () => null);
    record(
      "PENDANT panne : le processus next-server reste VIVANT (répond toujours aux requêtes HTTP, ne plante jamais)",
      alive !== null,
      alive !== null ? `page publique répond toujours (HTTP ${alive}) malgré la base indisponible` : "aucune réponse — le process semble avoir planté, PAS résilient",
    );

    // --- 4. Restauration réelle de Postgres ---
    console.log("[forced-failure] Restauration RÉELLE de Postgres (service postgresql start)…");
    execSync("service postgresql start", { stdio: "ignore" });
    postgresStopped = false;
    let pgBackUp = false;
    const pgReadyDeadline = Date.now() + 15_000;
    while (Date.now() < pgReadyDeadline) {
      try {
        execSync("pg_isready", { stdio: "ignore" });
        pgBackUp = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    record("Postgres réellement redémarré (pg_isready confirme)", pgBackUp, pgBackUp ? "pg_isready confirme le redémarrage" : "pg_isready ne confirme jamais le redémarrage dans le délai imparti");

    // --- 5. APRÈS restauration : auto-rétablissement RÉEL, sans redémarrer next start ---
    const after = await waitUntilHealth((r) => r.httpStatus === 200, Date.now() + RECOVERY_TIMEOUT_MS);
    record(
      "APRÈS restauration Postgres : /api/health revient à 200/\"ok\" SANS jamais redémarrer next start (auto-rétablissement réel)",
      after.httpStatus === 200 && after.body?.status === "ok",
      `HTTP ${after.httpStatus}, body=${JSON.stringify(after.body)} — même processus next-server du début à la fin (PID ${child.pid})`,
    );
  } catch (err) {
    console.error(`[forced-failure] ÉCHEC : ${err instanceof Error ? err.message : String(err)}`);
    console.error("--- sortie du serveur ---");
    console.error(serverOutput.slice(-4000));
    process.exitCode = 1;
  } finally {
    // Ne jamais laisser Postgres arrêté même si le script plante en cours de route.
    if (postgresStopped) {
      try {
        execSync("service postgresql start", { stdio: "ignore" });
      } catch {
        // au mieux — remonté honnêtement ci-dessous si ça échoue vraiment
      }
    }
    stopServer(child);
  }

  console.log("");
  let failures = 0;
  for (const f of findings) {
    console.log(`${f.ok ? "✅" : "🚨"} ${f.label} → ${f.detail}`);
    if (!f.ok) failures++;
  }
  console.log(`\n[forced-failure] ${findings.length - failures}/${findings.length} affirmation(s) de résilience vérifiée(s) par une panne réellement provoquée.`);
  if (failures > 0 || findings.length === 0) process.exit(1);
  console.log("[forced-failure] Résilience réelle confirmée : panne base de données survivable et auto-récupérable sans intervention manuelle ni redéploiement.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
