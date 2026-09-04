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
