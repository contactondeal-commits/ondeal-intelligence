import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OnDeal Intelligence",
  description: "Copilote e-commerce — dashboard, intelligence, recommandations et actions pour votre boutique.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // COMMERCIALISATION — App Bridge (app embarquée Shopify). Chargé depuis le
  // CDN officiel Shopify, en premier script de <head> (exigence Shopify),
  // sur TOUTE page de l'app — inoffensif hors contexte Shopify admin (le
  // global `shopify` reste simplement inutilisé par les visiteurs web
  // classiques). SHOPIFY_API_KEY n'est pas un secret (identifiant public de
  // l'app) — sûr à exposer dans le HTML rendu.
  const shopifyApiKey = process.env.SHOPIFY_API_KEY;
  const hasRealShopifyKey = Boolean(shopifyApiKey) && shopifyApiKey !== "changeme";

  return (
    <html lang="fr" className={inter.variable}>
      <head>
        {hasRealShopifyKey && (
          <>
            <meta name="shopify-api-key" content={shopifyApiKey} />
            {/* Chargement synchrone intentionnel — exigé par Shopify pour App
                Bridge (doit être disponible avant tout autre script de la
                page). async/defer casserait la détection embarquée. */}
            {/* eslint-disable-next-line @next/next/no-sync-scripts */}
            <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
          </>
        )}
        {/* Anti-CSRF (audit conformité 05/09/2026) — attache automatiquement
            le jeton double-soumission (cookie ondeal_csrf, non-httpOnly,
            voir lib/auth.ts) en en-tête X-CSRF-Token sur toute requête
            mutative envoyée vers CE MÊME site, sans modifier un seul des
            appels fetch existants de l'application (voir middleware.ts
            pour la vérification serveur). N'affecte jamais une requête vers
            un autre domaine — l'origine est vérifiée explicitement. Chargé
            en synchrone volontairement : doit patcher window.fetch avant
            tout autre script de la page. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  function readCookie(name){
    var m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : null;
  }
  var originalFetch = window.fetch;
  window.fetch = function(input, init){
    init = init || {};
    var method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var isRelative = url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0;
      var sameOrigin = isRelative || url.indexOf(window.location.origin) === 0;
      if (sameOrigin) {
        var token = readCookie('ondeal_csrf');
        if (token) {
          var headers = new Headers(init.headers || (typeof input !== 'string' && input && input.headers) || {});
          headers.set('X-CSRF-Token', token);
          init = Object.assign({}, init, { headers: headers });
        }
      }
    }
    return originalFetch.call(this, input, init);
  };
})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
