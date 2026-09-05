import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// ============================================================================
// COMMERCIALISATION — autorise dynamiquement l'affichage en iframe (Content-
// Security-Policy frame-ancestors) UNIQUEMENT pour l'admin Shopify d'une
// boutique authentifiée, et REFUSE tout framing par défaut ailleurs
// (anti-clickjacking, comportement identique à l'ancien X-Frame-Options:
// DENY statique). Remplace la partie framing des en-têtes de sécurité
// définis dans next.config.ts (CSP + X-Frame-Options désormais entièrement
// possédés ici — jamais les deux à la fois, pour éviter des en-têtes
// dupliqués/contradictoires).
// ============================================================================

const SESSION_COOKIE = "ondeal_session";
const MYSHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/i;

// ============================================================================
// ANTI-CSRF (audit conformité 05/09/2026) — motif "double soumission".
// Contexte : les sessions ouvertes depuis l'app embarquée Shopify utilisent
// un cookie SameSite=None (voir shopify-token-exchange/route.ts et
// auth.ts::setSessionCookie), nécessaire pour fonctionner dans l'iframe
// admin — mais SameSite=None fait que ce cookie est envoyé par le
// navigateur MÊME depuis un site tiers malveillant, ce qui rendrait les
// routes mutatives vulnérables au CSRF si elles ne se fiaient qu'au cookie
// de session. Le cookie CSRF_COOKIE (non-httpOnly, voir auth.ts) est lu et
// rejoué en en-tête X-CSRF-Token par le script du layout racine — un
// attaquant cross-site ne peut PAS lire ce cookie (politique same-origin)
// pour construire cet en-tête, même s'il peut faire envoyer le cookie de
// session lui-même. Dupliqué en dur ici (jamais importé de auth.ts, qui
// dépend de Prisma — incompatible avec le runtime edge du middleware).
// ============================================================================
const CSRF_COOKIE = "ondeal_csrf";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Routes API exemptées : soit elles n'ont pas encore de session (login,
// signup — la protection y viendrait d'ailleurs, ex. limitation de débit),
// soit elles s'authentifient déjà autrement qu'un cookie de session
// (webhooks : HMAC ; OAuth Shopify : état signé + HMAC ; session-token-exchange :
// jeton App Bridge en en-tête Authorization ; cron : déclenché par Vercel,
// jamais par un navigateur).
const CSRF_EXEMPT_PREFIXES = [
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/logout",
  "/api/webhooks/",
  "/api/shopify/callback",
  "/api/shopify/install",
  "/api/shopify/session-token-exchange",
  "/api/cron/",
];

function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function buildCsp(frameAncestors: string): string {
  return [
    "default-src 'self'",
    // Next.js injecte des scripts inline (hydratation) ; en développement,
    // le runtime a aussi besoin d'eval (HMR). App Bridge est chargé depuis
    // le CDN officiel Shopify (requis pour toute app embarquée).
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://cdn.shopify.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

async function readEmbeddedShopFromSession(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    const shop = typeof payload.embeddedShop === "string" ? payload.embeddedShop : null;
    return shop && MYSHOPIFY_DOMAIN.test(shop) ? shop : null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  // Vérification anti-CSRF — avant toute autre logique, pour toute requête
  // mutative vers une route API non exemptée (voir bloc de constantes
  // ci-dessus). Rejoue le motif double-soumission : le cookie et l'en-tête
  // doivent correspondre, tous deux présents.
  const { pathname } = req.nextUrl;
  if (MUTATING_METHODS.has(req.method) && pathname.startsWith("/api/") && !isCsrfExempt(pathname)) {
    const cookieToken = req.cookies.get(CSRF_COOKIE)?.value;
    const headerToken = req.headers.get("x-csrf-token");
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return NextResponse.json(
        { error: "Jeton de sécurité manquant ou invalide (CSRF). Rechargez la page et réessayez." },
        { status: 403 },
      );
    }
  }

  const res = NextResponse.next();

  // 1er chargement embarqué (avant toute session) : Shopify appelle
  // application_url avec ?shop=<domaine>. Validé strictement (même regex
  // que shopify-domain.ts) — jamais de confiance aveugle en un paramètre
  // d'URL pour autoriser du framing.
  const shopParam = req.nextUrl.searchParams.get("shop");
  let embedShop: string | null =
    shopParam && MYSHOPIFY_DOMAIN.test(shopParam) ? shopParam.toLowerCase() : null;

  // Navigations suivantes à l'intérieur de l'iframe (le paramètre "shop"
  // n'est pas forcément présent sur chaque route) : on se fie à la session
  // déjà établie via /api/shopify/session-token-exchange.
  if (!embedShop) {
    embedShop = await readEmbeddedShopFromSession(req);
  }

  if (embedShop) {
    res.headers.set("Content-Security-Policy", buildCsp(`https://admin.shopify.com https://${embedShop}`));
    // Ne JAMAIS envoyer X-Frame-Options ici : ça bloquerait l'affichage
    // dans l'admin Shopify indépendamment d'un CSP frame-ancestors correct
    // sur certains comportements navigateur (recommandation shopify.dev).
  } else {
    res.headers.set("Content-Security-Policy", buildCsp("'none'"));
    res.headers.set("X-Frame-Options", "DENY");
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
