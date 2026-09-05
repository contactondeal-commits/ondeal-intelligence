import Link from "next/link";
import { Building2, Store as StoreIcon, Plug, Users } from "lucide-react";
import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import BillingPanel from "@/components/BillingPanel";
import { PLAN_FEATURES } from "@/lib/plan-limits";
import { isStripeConfigured } from "@/lib/integrations/stripe-billing";

const FEATURE_LABEL: Record<string, string> = {
  dashboard: "Command Center",
  stock: "Stock Intelligence",
  reviews: "Review Intelligence",
  recommendations: "Recommandations",
  alerts: "Alertes",
  pricing: "Prix & Marge",
  marketing: "Marketing Intelligence",
  assistant: "OnDeal AI",
  automations: "Automatisations",
  reports: "Rapports",
  multi_store: "Multi-boutiques",
  suppliers: "Fournisseurs",
  advanced_automations: "Automatisations avancées",
  api: "API",
  audit_log: "Historique",
  team: "Équipe",
  agency_workspace: "Espace agence",
};

/**
 * PARAMÈTRES — direction produit 03/09/2026. Seules les sections qui
 * existent réellement sont affichées (organisation, plan, boutiques,
 * équipe, intégrations, synchronisation) ; aucune option factice
 * (facturation, notifications, planification) n'est présentée.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ store?: string; billing?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const store = await requireStore(resolvedSearchParams);
  const [org, members, planLimit, storeCounts, lastSync, integrations] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: store.organizationId },
      select: {
        name: true,
        plan: true,
        createdAt: true,
        billingProvider: true,
        shopifySubscriptionStatus: true,
        stripeSubscriptionStatus: true,
      },
    }),
    prisma.membership.findMany({ where: { organizationId: store.organizationId }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.planLimit.findUnique({ where: { plan: store.plan as "STARTER" | "PRO" | "BUSINESS" | "AGENCY" } }),
    prisma.product.groupBy({ by: ["storeId"], where: { storeId: { in: store.allStores.map((s) => s.id) } }, _count: true }),
    prisma.syncRun.findFirst({ where: { storeId: store.id, provider: "SHOPIFY" }, orderBy: { startedAt: "desc" } }),
    prisma.integration.findMany({ where: { storeId: store.id } }),
  ]);
  const productCountByStore = new Map(storeCounts.map((c) => [c.storeId, c._count]));
  const features = PLAN_FEATURES[store.plan] ?? [];
  const shopify = integrations.find((i) => i.provider === "SHOPIFY");
  const judgeme = integrations.find((i) => i.provider === "JUDGEME");

  return (
    <AppShell store={store} active="/settings">
      <div className="topbar">
        <div>
          <h1 className="page-title">Paramètres</h1>
          <p className="page-subtitle">Gérez votre organisation, vos boutiques et vos intégrations.</p>
        </div>
      </div>

      <nav className="segment-tabs" aria-label="Sections">
        <a href="#organisation" className="segment-tab is-active">
          Organisation
        </a>
        <a href="#boutiques" className="segment-tab">
          Boutiques
        </a>
        <a href="#integrations" className="segment-tab">
          Intégrations
        </a>
        <a href="#equipe" className="segment-tab">
          Équipe
        </a>
      </nav>

      <div className="cc-row cc-row-2" id="organisation">
        <section className="card cc-card" aria-labelledby="s-org">
          <h2 id="s-org" className="cc-card-title">
            <Building2 size={15} aria-hidden="true" /> Informations organisation
          </h2>
          <dl className="kv">
            <div>
              <dt>Nom de l&apos;organisation</dt>
              <dd>{org?.name ?? store.organizationName}</dd>
            </div>
            <div>
              <dt>Créée le</dt>
              <dd>{org?.createdAt ? org.createdAt.toLocaleDateString("fr-FR") : "—"}</dd>
            </div>
            <div>
              <dt>Boutiques</dt>
              <dd>{store.allStores.length}</dd>
            </div>
            <div>
              <dt>Membres</dt>
              <dd>{members.length}</dd>
            </div>
          </dl>
          <p className="cell-sub">La modification du nom et du logo n&apos;est pas encore disponible.</p>
        </section>

        <section className="card cc-card cc-brief" aria-labelledby="s-plan">
          <div className="cc-card-head">
            <h2 id="s-plan" className="cc-card-title">
              Votre plan actuel
            </h2>
            <span className="badge badge-test">{store.plan}</span>
          </div>
          <dl className="kv">
            <div>
              <dt>Boutiques</dt>
              <dd>
                {store.allStores.length} / {planLimit?.maxStores ?? "—"}
              </dd>
            </div>
            <div>
              <dt>Produits synchronisés (cette boutique)</dt>
              <dd>
                {(productCountByStore.get(store.id) ?? 0).toLocaleString("fr-FR")} / {planLimit ? planLimit.maxProducts.toLocaleString("fr-FR") : "—"}
              </dd>
            </div>
            <div>
              <dt>Utilisateurs</dt>
              <dd>
                {members.length} / {planLimit?.maxUsers ?? "—"}
              </dd>
            </div>
          </dl>
          <div className="feature-chips">
            {features.map((f) => (
              <span key={f} className="rail-chip is-active">
                {FEATURE_LABEL[f] ?? f}
              </span>
            ))}
          </div>
          <BillingPanel
            storeId={store.id}
            currentPlan={store.plan as "STARTER" | "PRO" | "BUSINESS" | "AGENCY"}
            shopifyConnected={shopify?.status === "CONNECTED"}
            shopifySubscriptionStatus={org?.shopifySubscriptionStatus ?? null}
            stripeConfigured={isStripeConfigured()}
            billingProvider={org?.billingProvider ?? null}
            stripeSubscriptionStatus={org?.stripeSubscriptionStatus ?? null}
            billingReturn={resolvedSearchParams.billing === "return" ? "shopify" : resolvedSearchParams.billing === "stripe_return" ? "stripe" : null}
          />
        </section>
      </div>

      <div className="cc-row cc-row-2" id="boutiques">
        <section className="card cc-card" aria-labelledby="s-stores">
          <h2 id="s-stores" className="cc-card-title">
            <StoreIcon size={15} aria-hidden="true" /> Boutiques
          </h2>
          <div className="table-scroll">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Type</th>
                  <th className="num">Produits</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {store.allStores.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-title">{s.name}</td>
                    <td>{s.isDemo ? <span className="badge badge-demo">Démo</span> : <span className="badge badge-suggestion">Réelle</span>}</td>
                    <td className="num">{(productCountByStore.get(s.id) ?? 0).toLocaleString("fr-FR")}</td>
                    <td>
                      <Link href={`/dashboard?store=${s.id}`} className="btn btn-secondary btn-sm">
                        Ouvrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card cc-card" id="integrations" aria-labelledby="s-sync">
          <h2 id="s-sync" className="cc-card-title">
            <Plug size={15} aria-hidden="true" /> Intégrations et synchronisation
          </h2>
          <dl className="kv">
            <div>
              <dt>Shopify</dt>
              <dd>{shopify?.status === "CONNECTED" ? <span className="badge badge-suggestion">Connecté</span> : <span className="badge badge-neutral">Non connecté</span>}</dd>
            </div>
            <div>
              <dt>Judge.me</dt>
              <dd>{judgeme?.status === "CONNECTED" ? <span className="badge badge-suggestion">Connecté</span> : <span className="badge badge-neutral">Non connecté</span>}</dd>
            </div>
            <div>
              <dt>Dernière synchronisation</dt>
              <dd>
                {lastSync?.finishedAt ? `${lastSync.finishedAt.toLocaleString("fr-FR")} · ${lastSync.status}` : "aucune"}
                {lastSync?.triggeredBy === "bulk_import" ? " (import bulk)" : ""}
              </dd>
            </div>
            <div>
              <dt>Fréquence</dt>
              <dd>
                Manuelle <span className="cell-sub">(planification non implémentée)</span>
              </dd>
            </div>
          </dl>
          <Link href={`/settings/integrations?store=${store.id}`} className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
            Gérer les intégrations
          </Link>
        </section>
      </div>

      <section className="card cc-card" id="equipe" aria-labelledby="s-team">
        <h2 id="s-team" className="cc-card-title">
          <Users size={15} aria-hidden="true" /> Équipe
        </h2>
        <div className="table-scroll">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Rôle</th>
                <th>Depuis</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="cell-title">{m.user.name}</td>
                  <td className="cell-sub">{m.user.email}</td>
                  <td>
                    <span className="badge badge-neutral">{m.role}</span>
                  </td>
                  <td className="cell-sub">{m.createdAt.toLocaleDateString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cell-sub">L&apos;invitation de membres n&apos;est pas encore disponible dans cette version.</p>
      </section>
    </AppShell>
  );
}
