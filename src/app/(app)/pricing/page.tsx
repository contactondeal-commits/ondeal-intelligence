import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import MetricCard from "@/components/MetricCard";
import CostAssumptionForm from "@/components/CostAssumptionForm";
import { analyzeMargin, summarizeMargin, type MarginInput } from "@/lib/intelligence/margin";

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);

  const products = await prisma.product.findMany({
    where: { storeId: store.id },
    include: { variants: true, costAssumption: true },
  });

  const analyses = products.flatMap((p) =>
    p.variants.map((v) => {
      const input: MarginInput = {
        productId: p.id,
        variantId: v.id,
        title: p.variants.length > 1 ? `${p.title} — ${v.title}` : p.title,
        sellingPrice: v.price,
        supplierCost: p.costAssumption?.supplierCost ?? null,
        shippingCost: p.costAssumption?.shippingCost ?? null,
        paymentFeesRate: p.costAssumption?.paymentFeesRate ?? null,
        otherFixedCost: p.costAssumption?.otherFixedCost ?? null,
      };
      return analyzeMargin(input);
    }),
  );
  const summary = summarizeMargin(analyses);

  return (
    <AppShell store={store} active="/pricing">
      <h1 className="page-title">Prix & Marge</h1>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>
        Marge = prix de vente − (coût fournisseur + transport + frais de paiement + autres coûts). Toute hypothèse
        manquante bloque le calcul plutôt que d'être supposée à 0.
      </p>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <MetricCard label="Produits avec marge calculable" value={`${summary.withData}/${summary.total}`} available />
        <MetricCard label="Marge négative" value={String(summary.negative)} available />
        <MetricCard label="Marge faible (&lt;15%)" value={String(summary.faible)} available />
        <MetricCard label="Taux de marge moyen" value={summary.averageRate !== null ? `${(summary.averageRate * 100).toFixed(1)}%` : null} />
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Détail par produit</h2>
        {analyses.length === 0 ? (
          <p className="unavailable-note">Aucun produit synchronisé.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Produit</th><th>Prix</th><th>Coût total</th><th>Marge</th><th>Taux</th><th>Hypothèses manquantes</th><th>Modifier</th></tr>
            </thead>
            <tbody>
              {analyses.map((a) => (
                <tr key={a.variantId}>
                  <td>{a.title}</td>
                  <td>{a.sellingPrice !== null ? `${a.sellingPrice.toFixed(2)} €` : <span className="unavailable-note">n/d</span>}</td>
                  <td>{a.totalCost !== null ? `${a.totalCost.toFixed(2)} €` : <span className="unavailable-note">n/d</span>}</td>
                  <td style={{ color: a.margin !== null && a.margin < 0 ? "#dc2626" : undefined, fontWeight: 700 }}>
                    {a.margin !== null ? `${a.margin.toFixed(2)} €` : <span className="unavailable-note">n/d</span>}
                  </td>
                  <td>{a.marginRate !== null ? `${(a.marginRate * 100).toFixed(1)}%` : <span className="unavailable-note">n/d</span>}</td>
                  <td>{a.missingAssumptions.length > 0 ? a.missingAssumptions.join(", ") : "—"}</td>
                  <td><CostAssumptionForm storeId={store.id} productId={a.productId} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
