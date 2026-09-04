import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import IntegrationCard from "@/components/IntegrationCard";

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ store?: string; connected?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const store = await requireStore(resolvedSearchParams);
  const integrations = await prisma.integration.findMany({ where: { storeId: store.id } });

  const shopify = integrations.find((i) => i.provider === "SHOPIFY");
  const judgeme = integrations.find((i) => i.provider === "JUDGEME");

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
      </div>
    </AppShell>
  );
}
