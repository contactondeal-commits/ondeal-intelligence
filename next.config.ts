import type { NextConfig } from "next";

// Le lint est exécuté séparément via `npm run lint` (voir BUILD/CI) —
// Next.js 16 a retiré l'intégration ESLint intégrée de la config de build.
//
// En-têtes de sécurité (production 04/09/2026) : anti-clickjacking, anti-MIME
// sniffing, HSTS, politique de referrer et de permissions. Les images
// produits proviennent du CDN Shopify (cdn.shopify.com).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js injecte des scripts inline (hydratation) ; en développement,
      // le runtime a aussi besoin d'eval (HMR). Jamais en production.
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
