import type { NextRequest } from "next/server";

/**
 * Limiteur de débit en mémoire (fenêtre glissante simple) — protection
 * anti-force brute des routes d'authentification.
 *
 * LIMITE CONNUE (documentée dans le rapport de livraison) : en environnement
 * serverless (Vercel), chaque instance possède sa propre mémoire ; la limite
 * est donc appliquée par instance et non globalement. Elle réduit fortement
 * la vitesse d'une attaque depuis une même instance mais ne remplace pas un
 * limiteur partagé (Vercel WAF / Upstash) pour une protection stricte.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export function rateLimit(key: string, opts: { max: number; windowMs: number }): { ok: boolean; retryAfterSeconds: number } {
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

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
