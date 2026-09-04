import type { NextConfig } from "next";

// Le lint est exécuté séparément via `npm run lint` (voir BUILD/CI) —
// Next.js 16 a retiré l'intégration ESLint intégrée de la config de build.
//
// En-têtes de sécurité (production 04/09/2026) : anti-MIME sniffing, HSTS,
// politique de referrer et de permissions. Les images produits proviennent
// du CDN Shopify (cdn.shopify.com).
//
// X-Frame-Options et Content-Security-Policy (frame-ancestors) NE SONT PAS
// définis ici : depuis la commercialisation Shopify (app embarquée), ils
// doivent varier selon la requête (autoriser l'iframe admin Shopify pour une
// session embarquée authentifiée, refuser tout framing ailleurs). Cette
// logique dynamique vit exclusivement dans src/middleware.ts — la définir
// aussi ici créerait deux en-têtes CSP concurrents (le navigateur applique
// alors l'intersection des deux, ce qui bloquerait le framing même quand
// middleware.ts l'autorise légitimement).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
