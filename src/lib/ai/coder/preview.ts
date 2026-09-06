import { type ChildProcess, spawn } from "node:child_process";

/**
 * ONDEAL AI CORE — PHASE 3 : serveur de preview local (06/09/2026).
 *
 * `next start` du workspace de mission (jamais du dépôt de travail réel),
 * lié EXCLUSIVEMENT à 127.0.0.1 — jamais 0.0.0.0 (aucune exposition réseau
 * au-delà de ce process, voir self-review §19 "browser SSRF" : le Browser
 * Agent ne peut de toute façon naviguer que vers cette origine, voir
 * browser.ts::assertOriginAllowed). Aucune variable d'environnement secrète
 * héritée — même principe que operations.ts.
 */
export interface PreviewServer {
  process: ChildProcess;
  origin: string;
}

async function waitForReady(origin: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(origin, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return;
    } catch {
      // pas encore prêt — retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Le serveur de preview n'a pas répondu dans les ${timeoutMs}ms impartis (${origin}).`);
}

export async function startPreviewServer(root: string, port: number): Promise<PreviewServer> {
  // `detached: true` : `npx next start` engendre lui-même un processus
  // `next-server` réel (souvent via un `sh -c` intermédiaire) — sans ceci,
  // tuer uniquement le PID de `npx`/`sh` laisserait `next-server` orphelin,
  // toujours lié au port, indéfiniment (constaté empiriquement en §19
  // self-review : plusieurs `next-server` orphelins de missions précédentes
  // toujours actifs). `stopPreviewServer` cible le GROUPE entier ci-dessous.
  const child = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(origin, 30_000);
  } catch (err) {
    stopPreviewServer({ process: child, origin });
    throw err;
  }
  return { process: child, origin };
}

export function stopPreviewServer(server: PreviewServer): void {
  const pid = server.process.pid;
  if (typeof pid === "number") {
    try {
      process.kill(-pid, "SIGKILL"); // groupe entier (npx + sh + next-server réel) — jamais uniquement le PID de tête
      return;
    } catch {
      // le groupe n'existe déjà plus, ou kill par groupe non supporté — repli ci-dessous
    }
  }
  server.process.kill("SIGKILL");
}
