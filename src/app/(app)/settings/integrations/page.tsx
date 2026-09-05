import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import AppShell from "@/components/AppShell";
import IntegrationCard from "@/components/IntegrationCard";
import GoogleAnalyticsCard from "@/components/GoogleAnalyticsCard";
import type { GoogleAnalyticsCredentials } from "@/lib/integrations/google-analytics";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; connected?: string; gaError?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const store = await requireStore(resolvedSearchParams);
  const integrations = await prisma.integration.findMany({ where: { storeId: store.id } });

  const shopify = integrations.find((i) => i.provider === "SHOPIFY");
  const judgeme = integrations.find((i) => i.provider === "JUDGEME");
  const woocommerce = integrations.find((i) => i.provider === "WOOCOMMERCE");
  const prestashop = integrations.find((i) => i.provider === "PRESTASHOP");
  const cjdropshipping = integrations.find((i) => i.provider === "CJDROPSHIPPING");
  const googleAnalytics = integrations.find((i) => i.provider === "GOOGLE_ANALYTICS");

  // Déchiffré ICI (composant serveur) uniquement pour afficher la propriété
  // choisie et savoir si la sélection reste en attente — jamais transmis au
  // client (la carte ne reçoit que propertyDisplayName, jamais le refreshToken).
  let gaPropertyDisplayName: string | null = null;
  let gaAwaitingPropertySelection = false;
  if (googleAnalytics?.status === "CONNECTED" && googleAnalytics.encryptedCredentials) {
    try {
      const creds = decryptJson<GoogleAnalyticsCredentials>(googleAnalytics.encryptedCredentials);
      gaPropertyDisplayName = creds.propertyDisplayName;
      gaAwaitingPropertySelection = !creds.propertyId;
    } catch {
      gaAwaitingPropertySelection = false;
    }
  }

  return (
    <AppShell store={store} active="/settings">
      <h1 className="page-title">Intégrations</h1>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>
        Chaque connecteur est indépendant : si l'un n'est pas connecté, le reste de l'application continue de
        fonctionner avec les données disponibles.
      </p>

      {resolvedSearchParams.connected === "shopify" && (
        <div className="callout callout-info" style={{ marginBottom: 18 }}>
          Shopify est connecté. La première synchronisation démarre automatiquement — retrouvez son statut dans
          Paramètres.
        </div>
      )}

      {resolvedSearchParams.connected === "google_analytics" && (
        <div className="callout callout-info" style={{ marginBottom: 18 }}>
          Google Analytics est autorisé — choisissez votre propriété GA4 ci-dessous pour démarrer la synchronisation.
        </div>
      )}
      {resolvedSearchParams.gaError && (
        <div className="callout callout-error" style={{ marginBottom: 18 }}>
          Connexion Google Analytics interrompue : {resolvedSearchParams.gaError}
        </div>
      )}

      <div className="callout callout-info" style={{ marginBottom: 18, fontSize: 12.5 }}>
        Shopify, WooCommerce et PrestaShop sont des connecteurs <strong>catalogue</strong> — une seule de ces
        trois intégrations peut être connectée à la fois par boutique. Déconnectez l&apos;une avant d&apos;en
        connecter une autre.
      </div>

      <div className="grid grid-2">
        <IntegrationCard
          storeId={store.id}
          provider="SHOPIFY"
          title="Shopify"
          description="Catalogue, stock, commandes."
          status={shopify?.status ?? "NOT_CONNECTED"}
          lastError={shopify?.lastError ?? null}
          lastSyncedAt={shopify?.lastSyncedAt?.toISOString() ?? null}
          oauthInstall
          fields={[
            { key: "domain", label: "Domaine boutique", placeholder: "ma-boutique.myshopify.com" },
            { key: "accessToken", label: "Jeton d'accès Admin API", placeholder: "shpat_xxxxxxxx", type: "password" },
          ]}
          manualHelp={
            <>
              Jeton d&apos;accès <strong>Admin API</strong> (commence par <code>shpat_</code>) d&apos;une application
              personnalisée Shopify avec les autorisations : Produits (lecture/écriture), Stock
              (lecture/écriture), Commandes (lecture). Admin Shopify → Paramètres → Applications et canaux de vente
              → Développer des applications → Identifiants API. Marche à suivre détaillée dans le{" "}
              <a href={`/guide?store=${store.id}`} style={{ color: "inherit", fontWeight: 700 }}>Guide</a>.
            </>
          }
        />
        <IntegrationCard
          storeId={store.id}
          provider="WOOCOMMERCE"
          title="WooCommerce"
          description="Catalogue, stock, commandes (WordPress)."
          status={woocommerce?.status ?? "NOT_CONNECTED"}
          lastError={woocommerce?.lastError ?? null}
          lastSyncedAt={woocommerce?.lastSyncedAt?.toISOString() ?? null}
          fields={[
            { key: "siteUrl", label: "Adresse du site", placeholder: "https://ma-boutique.com" },
            { key: "consumerKey", label: "Clé consommateur (Consumer key)", placeholder: "ck_xxxxxxxx" },
            { key: "consumerSecret", label: "Secret consommateur (Consumer secret)", placeholder: "cs_xxxxxxxx", type: "password" },
          ]}
          manualHelp={
            <>
              WordPress admin → <strong>WooCommerce</strong> → <strong>Réglages</strong> →{" "}
              <strong>Avancé</strong> → <strong>API REST</strong> → <strong>Ajouter une clé</strong> — autorisations{" "}
              <strong>Lecture</strong> (ou Lecture/Écriture si vous prévoyez des actions futures). La clé et le
              secret ne s&apos;affichent qu&apos;une seule fois : copiez-les immédiatement.
            </>
          }
        />
        <IntegrationCard
          storeId={store.id}
          provider="PRESTASHOP"
          title="PrestaShop"
          description="Catalogue, stock, commandes."
          status={prestashop?.status ?? "NOT_CONNECTED"}
          lastError={prestashop?.lastError ?? null}
          lastSyncedAt={prestashop?.lastSyncedAt?.toISOString() ?? null}
          fields={[
            { key: "siteUrl", label: "Adresse du site", placeholder: "https://ma-boutique.fr" },
            { key: "apiToken", label: "Clé Webservice", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", type: "password" },
          ]}
          manualHelp={
            <>
              Admin PrestaShop → <strong>Paramètres avancés</strong> → <strong>Webservice</strong> → activez le
              webservice puis <strong>Ajouter une nouvelle clé</strong> — cochez au minimum les autorisations GET
              sur Products, Combinations, StockAvailables, Orders, OrderDetails, OrderStates, Categories,
              ProductOptionValues et Currencies.
            </>
          }
        />
        <IntegrationCard
          storeId={store.id}
          provider="JUDGEME"
          title="Judge.me"
          description="Avis clients réels (jeton API privé, pas le jeton public)."
          status={judgeme?.status ?? "NOT_CONNECTED"}
          lastError={judgeme?.lastError ?? null}
          lastSyncedAt={judgeme?.lastSyncedAt?.toISOString() ?? null}
          fields={[
            { key: "shopDomain", label: "Domaine boutique", placeholder: "ma-boutique.myshopify.com" },
            { key: "apiToken", label: "Jeton API privé", placeholder: "xxxxxxxxxxxxxxxx", type: "password" },
          ]}
          manualHelp={
            <>
              Admin Judge.me → <strong>Settings</strong> → <strong>Integrations</strong> → <strong>View API
              tokens</strong> (en haut à droite) → copiez <strong>Your Private API Token</strong> — jamais le jeton
              public, insuffisant pour cet usage.
            </>
          }
        />
        <IntegrationCard
          storeId={store.id}
          provider="CJDROPSHIPPING"
          title="CJdropshipping"
          description="Vérifie le vrai stock fournisseur sur vos ruptures (lecture seule — n'écrit jamais sur Shopify ni sur CJ)."
          status={cjdropshipping?.status ?? "NOT_CONNECTED"}
          lastError={cjdropshipping?.lastError ?? null}
          lastSyncedAt={cjdropshipping?.lastSyncedAt?.toISOString() ?? null}
          fields={[{ key: "apiKey", label: "Clé API CJ", placeholder: "CJ5xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx32", type: "password" }]}
          manualHelp={
            <>
              cjdropshipping.com → connecté → <strong>My CJ</strong> → <strong>Authorization</strong> →{" "}
              <strong>API</strong> → <strong>Add API</strong> (type API Key) → copiez la clé générée. Fournisseur
              indépendant du catalogue : vous pouvez la connecter en plus de Shopify/WooCommerce/PrestaShop.
            </>
          }
        />
        <GoogleAnalyticsCard
          storeId={store.id}
          status={googleAnalytics?.status ?? "NOT_CONNECTED"}
          lastError={googleAnalytics?.lastError ?? null}
          lastSyncedAt={googleAnalytics?.lastSyncedAt?.toISOString() ?? null}
          propertyDisplayName={gaPropertyDisplayName}
          awaitingPropertySelection={gaAwaitingPropertySelection}
        />
      </div>
    </AppShell>
  );
}
