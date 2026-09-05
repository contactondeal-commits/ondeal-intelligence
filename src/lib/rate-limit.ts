import type { NextRequest } from "next/server";

/**
 * Limiteur de débit — audit conformité 05/09/2026.
 *
 * Utilise Upstash Redis (REST, compatible edge/serverless) quand
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN sont configurés : le
 * compteur est alors PARTAGÉ entre toutes les instances Vercel, ce qui
 * corrige la limite connue du repli mémoire ci-dessous (documentée dans le
 * rapport de livraison du 04/09/2026). Sans ces variables, repli
 * automatique et silencieux sur un compteur en mémoire locale — une
 * protection réduite mais non nulle, jamais un blocage de l'application.
 *
 * Aucune nouvelle dépendance npm : appel direct à l'API REST Upstash
 * (simple HTTPS + jeton), pour ne pas risquer une désynchronisation
 * package.json / package-lock.json lors du déploiement.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function memoryRateLimit(key: string, opts: { max: number; windowMs: number }): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      if (buckets.size >= MAX_BUCKETS) buckets.clear();
    }
    b = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > opts.max) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  return { ok: true, retryAfterSeconds: 0 };
}

function isUpstashConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Incrémente le compteur distant et fixe son expiration à la première
 * requête de la fenêtre (NX : ne réinitialise jamais une fenêtre déjà
 * commencée). Retourne null en cas d'échec réseau/config — l'appelant
 * bascule alors sur le repli mémoire plutôt que d'échouer la requête.
 */
async function redisIncr(key: string, windowMs: number): Promise<number | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCR", `ratelimit:${key}`],
        ["PEXPIRE", `ratelimit:${key}`, String(windowMs), "NX"],
      ]),
      // Un rate-limiter ne doit jamais devenir le goulot d'étranglement de la
      // requête qu'il protège : délai court, repli mémoire sinon.
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    const count = Number(json?.[0]?.result);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

export async function rateLimit(key: string, opts: { max: number; windowMs: number }): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  if (isUpstashConfigured()) {
    const count = await redisIncr(key, opts.windowMs);
    if (count !== null) {
      if (count > opts.max) {
        return { ok: false, retryAfterSeconds: Math.ceil(opts.windowMs / 1000) };
      }
      return { ok: true, retryAfterSeconds: 0 };
    }
    // Échec réseau Upstash — repli mémoire pour cette requête plutôt que de
    // laisser passer sans aucune limite.
  }
  return memoryRateLimit(key, opts);
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
