import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import FeatureUnavailable from "@/components/FeatureUnavailable";
import BackButton from "@/components/BackButton";
import { hasFeature } from "@/lib/plan-limits";
import DataTag from "@/components/ui/DataTag";
import DecisionCard from "@/components/DecisionCard";
import PriceSimulator from "@/components/pricing/PriceSimulator";
import CostAssumptionForm from "@/components/CostAssumptionForm";
import { analyzeMargin, MARGIN_THRESHOLDS } from "@/lib/intelligence/margin";
import { resolveCostInputs, supplierCostSourceLabel, assumptionSourceLabel } from "@/lib/intelligence/costs";
import type { GroupableRecommendation } from "@/lib/intelligence/group";

function eur(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(2)} €`;
}
function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)} %`;
}

/**
 * DECISION WORKSPACE d'une variante réelle — ÉTAT ACTUEL (données réelles
 * étiquetées) → SCÉNARIO SIMULÉ → DONNÉES UTILISÉES & CONFIANCE → DÉCISION.
 * La décision (validation humaine, snapshot, prédiction, action Shopify,
 * vérification, résultat) passe par la Decision Card Phase 3 existante,
 * alimentée par la recommandation de marge ouverte sur cette variante. Sans
 * signal ouvert, la page reste un simulateur : aucune action ne peut être
 * engagée hors d'une recommandation.
 */
export default async function VariantWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ variantId: string }>;
  searchParams: Promise<{ store?: string }>;
}) {
  const store = await requireStore(await searchParams);
  if (!hasFeature(store.plan, "pricing")) {
    return (
      <AppShell store={store} active="/pricing">
        <FeatureUnavailable feature="Prix & Marge" plan={store.plan} storeId={store.id} />
      </AppShell>
    );
  }
  const { variantId } = await params;

  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    include: { product: { include: { costAssumption: true, _count: { select: { variants: true } } } } },
  });
  if (!variant || variant.product.storeId !== store.id) notFound();

  const storeDefaults = await prisma.store.findUnique({ where: { id: store.id }, select: { defaultShippingCost: true, defaultPaymentFeesRate: true } });
  const costs = resolveCostInputs(variant, variant.product.costAssumption, storeDefaults);
  const title = variant.product._count.variants > 1 ? `${variant.product.title} — ${variant.title}` : variant.product.title;
  const analysis = analyzeMargin({
    productId: variant.product.id,
    variantId: variant.id,
    title,
    sellingPrice: variant.price,
    supplierCost: costs.supplierCost,
    supplierCostSource: costs.supplierCostSource,
    shippingCost: costs.shippingCost,
    paymentFeesRate: costs.paymentFeesRate,
    otherFixedCost: costs.otherFixedCost,
  });

  // Signal ouvert sur cette variante (recommandation de marge, update_price).
  const marginRecs = await prisma.recommendation.findMany({
    where: { storeId: store.id, status: "OPEN", category: "margin", actionType: "update_price", productId: variant.product.id },
    include: { product: { select: { id: true, title: true } } },
  });
  const recommendation = marginRecs.find((r) => {
    try {
      return (JSON.parse(r.actionPayloadJson ?? "{}") as { variantId?: string }).variantId === variant.id;
    } catch {
      return false;
    }
  });

  // Reprise d'une décision déjà entamée (même logique que le Command Center).
  const existingAction = recommendation
    ? await prisma.actionItem.findFirst({ where: { storeId: store.id, recommendationId: recommendation.id }, orderBy: { createdAt: "desc" } })
    : null;
  const serializedAction = existingAction
    ? {
        id: existingAction.id,
        type: existingAction.type,
        sensitivity: existingAction.sensitivity as "SENSITIVE" | "SAFE",
        status: existingAction.status,
        payload: JSON.parse(existingAction.payloadJson) as Record<string, unknown>,
        resultJson: existingAction.resultJson,
        createdAt: existingAction.createdAt.toISOString(),
        confirmedAt: existingAction.confirmedAt?.toISOString() ?? null,
        executedAt: existingAction.executedAt?.toISOString() ?? null,
      }
    : null;

  const groupable: GroupableRecommendation | null = recommendation
    ? {
        id: recommendation.id,
        category: recommendation.category,
        severity: recommendation.severity,
        title: recommendation.title,
        reason: recommendation.reason,
        impact: recommendation.impact,
        confidence: recommendation.confidence,
        impactScore: recommendation.impactScore,
        actionLabel: recommendation.actionLabel,
        actionType: recommendation.actionType,
        actionPayloadJson: recommendation.actionPayloadJson,
        product: recommendation.product,
      }
    : null;

  // Niveau de confiance de la simulation — dérivé des SOURCES, jamais un
  // pourcentage inventé : ce que l'on sait vraiment, et ce qui manque.
  const confidence =
    costs.supplierCostSource === "shopify_unit_cost"
      ? { level: "Élevé", detail: "Prix et coût fournisseur lus dans Shopify. La marge brute est calculée sur des données réelles." }
      : costs.supplierCostSource === "cost_assumption"
        ? { level: "Partiel", detail: "Le coût fournisseur est une hypothèse OnDeal (Shopify n'en fournit pas pour cette variante)." }
        : { level: "Insuffisant", detail: "Aucun coût fournisseur connu : aucune marge ne peut être calculée ni simulée honnêtement." };
  const fullMarginNote = analysis.margin !== null ? "Marge complète calculée avec des hypothèses (transport, frais) — estimée, pas mesurée." : "Marge complète non calculable : transport et/ou frais de paiement non renseignés.";

  return (
    <AppShell store={store} active="/pricing">
      <div className="topbar">
        <div>
          <BackButton fallbackHref={`/pricing?store=${store.id}`} />
          <div className="breadcrumb">
            <Link href={`/pricing?store=${store.id}`}>Prix & Marge</Link> <span aria-hidden="true">/</span> <span>{variant.product.title}</span>
          </div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">
            Decision Workspace — état actuel réel, scénario simulé, données utilisées, puis décision validée par vous.
            {variant.sku ? ` SKU ${variant.sku}.` : ""}
          </p>
        </div>
      </div>

      <div className="workspace-grid">
        <section className="card workspace-card" aria-labelledby="ws-current">
          <h2 id="ws-current" className="workspace-title">
            État actuel
          </h2>
          <dl className="kv">
            <div>
              <dt>
                Prix de vente <DataTag status={analysis.status.sellingPrice} compact />
              </dt>
              <dd>{eur(analysis.sellingPrice)}</dd>
            </div>
            <div>
              <dt>
                Coût fournisseur <DataTag status={analysis.status.supplierCost} compact />
              </dt>
              <dd>
                {eur(analysis.supplierCost)} <span className="cell-sub">{supplierCostSourceLabel(analysis.supplierCostSource)}</span>
              </dd>
            </div>
            <div>
              <dt>
                Stock <DataTag status="real" compact />
              </dt>
              <dd>{variant.inventoryQuantity ?? "—"}</dd>
            </div>
            <div className="kv-strong">
              <dt>
                Marge brute <DataTag status={analysis.status.grossMargin} compact />
              </dt>
              <dd className={analysis.grossMargin !== null && analysis.grossMargin < 0 ? "is-negative" : analysis.grossMarginRate !== null && analysis.grossMarginRate < MARGIN_THRESHOLDS.faibleRate ? "is-low" : ""}>
                {eur(analysis.grossMargin)} <span className="cell-sub">({pct(analysis.grossMarginRate)})</span>
              </dd>
            </div>
            <div>
              <dt>
                Transport <DataTag status={analysis.status.shippingCost} compact />
              </dt>
              <dd>
                {eur(analysis.shippingCost)} <span className="cell-sub">{assumptionSourceLabel(costs.shippingCostSource)}</span>
              </dd>
            </div>
            <div>
              <dt>
                Frais de paiement <DataTag status={analysis.status.paymentFees} compact />
              </dt>
              <dd>
                {analysis.paymentFees !== null ? `${eur(analysis.paymentFees)} (${pct(costs.paymentFeesRate)})` : "—"}{" "}
                <span className="cell-sub">{assumptionSourceLabel(costs.paymentFeesRateSource)}</span>
              </dd>
            </div>
            <div className="kv-strong">
              <dt>
                Marge complète <DataTag status={analysis.status.margin} compact />
              </dt>
              <dd className={analysis.margin !== null && analysis.margin < 0 ? "is-negative" : ""}>
                {analysis.margin !== null ? (
                  <>
                    {eur(analysis.margin)} <span className="cell-sub">({pct(analysis.marginRate)})</span>
                  </>
                ) : (
                  <span className="cell-sub">hypothèses manquantes</span>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="card workspace-card" aria-labelledby="ws-confidence">
          <h2 id="ws-confidence" className="workspace-title">
            Données utilisées et confiance
          </h2>
          <div className={`confidence confidence-${confidence.level === "Élevé" ? "high" : confidence.level === "Partiel" ? "mid" : "low"}`}>
            <span className="confidence-level">{confidence.level}</span>
            <span className="confidence-detail">{confidence.detail}</span>
          </div>
          <ul className="source-list">
            <li>
              <DataTag status="real" compact /> Prix, stock : Shopify, dernière synchronisation {variant.updatedAt.toLocaleString("fr-FR")}.
            </li>
            <li>
              <DataTag status={analysis.status.supplierCost} compact /> Coût fournisseur : {supplierCostSourceLabel(costs.supplierCostSource)}
              {variant.unitCostCurrency ? ` (${variant.unitCostCurrency})` : ""}.
            </li>
            <li>
              <DataTag status={analysis.margin !== null ? "estimated" : "unavailable"} compact /> {fullMarginNote}
            </li>
            <li>
              <DataTag status="unavailable" compact /> Ventes après changement de prix : aucun modèle de demande — la simulation ne prédit ni volume ni chiffre d&apos;affaires.
            </li>
          </ul>
          <div className="workspace-assumptions">
            <span className="cell-sub">Hypothèses produit (repli et override des hypothèses boutique) :</span>
            <CostAssumptionForm storeId={store.id} productId={variant.product.id} />
          </div>
        </section>
      </div>

      {groupable ? (
        <section className="card workspace-card" aria-labelledby="ws-decision" style={{ marginTop: 16 }}>
          <h2 id="ws-decision" className="workspace-title">
            Décision
          </h2>
          <p className="cell-sub" style={{ marginBottom: 12 }}>
            Signal ouvert sur cette variante. Le scénario est simulé ci-dessous, puis validé par vous, capturé (snapshot et prédiction), exécuté sur Shopify,
            vérifié et mesuré.
          </p>
          <DecisionCard
            group={{
              key: groupable.id,
              category: groupable.category,
              severity: groupable.severity,
              product: groupable.product ?? null,
              items: [groupable],
              title: groupable.title,
              confidence: groupable.confidence,
              representative: groupable,
              impactScore: groupable.impactScore ?? null,
              impactCoverage: groupable.impactScore != null ? 1 : 0,
            }}
            storeId={store.id}
            existingAction={serializedAction}
          />
        </section>
      ) : (
        <section className="card workspace-card" aria-labelledby="ws-sim" style={{ marginTop: 16 }}>
          <h2 id="ws-sim" className="workspace-title">
            Scénario simulé
          </h2>
          <p className="cell-sub" style={{ marginBottom: 12 }}>
            Aucun signal de marge ouvert sur cette variante : vous pouvez simuler librement, mais une action ne s&apos;engage que depuis une recommandation
            (Command Center ou Centre d&apos;intelligence).
          </p>
          <PriceSimulator
            input={{
              productId: variant.product.id,
              variantId: variant.id,
              title,
              currentPrice: variant.price,
              supplierCost: costs.supplierCost,
              supplierCostSource: costs.supplierCostSource,
              shippingCost: costs.shippingCost,
              paymentFeesRate: costs.paymentFeesRate,
              otherFixedCost: costs.otherFixedCost,
            }}
          />
        </section>
      )}
    </AppShell>
  );
}
