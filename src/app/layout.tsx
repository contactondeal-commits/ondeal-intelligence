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
      {hasRealShopifyKey && (
        <head>
          <meta name="shopify-api-key" content={shopifyApiKey} />
          {/* Chargement synchrone intentionnel — exigé par Shopify pour App
              Bridge (doit être disponible avant tout autre script de la
              page). async/defer casserait la détection embarquée. */}
          {/* eslint-disable-next-line @next/next/no-sync-scripts */}
          <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        </head>
      )}
      <body>{children}</body>
    </html>
  );
}
