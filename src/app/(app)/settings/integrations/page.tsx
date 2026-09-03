import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import IntegrationCard from "@/components/IntegrationCard";

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);
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

      <div className="grid grid-2">
        <IntegrationCard
          storeId={store.id}
          provider="SHOPIFY"
          title="Shopify"
          description="Catalogue, stock, commandes (Admin API — jeton d'application personnalisée)."
          status={shopify?.status ?? "NOT_CONNECTED"}
          lastError={shopify?.lastError ?? null}
          lastSyncedAt={shopify?.lastSyncedAt?.toISOString() ?? null}
          fields={[
            { key: "domain", label: "Domaine boutique", placeholder: "ma-boutique.myshopify.com" },
            { key: "accessToken", label: "Jeton d'accès Admin API", placeholder: "shpat_xxxxxxxx", type: "password" },
          ]}
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
        />
      </div>
    </AppShell>
  );
}
