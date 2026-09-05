import Link from "next/link";
import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import MetricCard from "@/components/MetricCard";
import BackButton from "@/components/BackButton";
import { SEVERITY_META } from "@/components/ui/severity";
import { notFound } from "next/navigation";

// CORRECTIF 05/09/2026 — de brèves explications sous "Marge"/"Santé du
// stock" quand non disponibles : sans ça, l'utilisateur ne peut pas savoir
// QUOI faire pour débloquer le facteur (voir diagnostic session du jour).
// Clé = label affiché tel quel dans le ScoreSnapshot (score.ts, FACTORS).
const UNAVAILABLE_HINTS: Record<string, string> = {
  "Marge": "Coût produit manquant — renseignez-le sur la fiche variante (lien ci-dessous) ou via \"Cost per item\" dans Shopify.",
  "Santé du stock": "Pas encore assez d'historique de ventes récentes synchronisé pour ce produit — se met à jour à la prochaine synchronisation.",
  "Évolution des ventes": "Facteur pas encore disponible dans cette version d'OnDeal.",
};

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ store?: string }>;
}) {
  const store = await requireStore(await searchParams);
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: true,
      reviews: { orderBy: { publishedAt: "desc" }, take: 10 },
      costAssumption: true,
      scoreSnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
      recommendations: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!product || product.storeId !== store.id) notFound();

  const scoreBreakdown = product.scoreSnapshots[0] ? (JSON.parse(product.scoreSnapshots[0].factorsJson) as {
    score: number;
    dataCompleteness: number;
    factors: Array<{ label: string; contribution: number; available: boolean; normalizedValue: number | null }>;
  }) : null;

  const avgRating = product.reviews.length > 0 ? product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length : null;
  const totalStock = product.variants.reduce((s, v) => s + (v.inventoryQuantity ?? 0), 0);
  const anyStockKnown = product.variants.some((v) => v.inventoryQuantity !== null);

  return (
    <AppShell store={store} active="/products">
      <div className="topbar">
        <div>
          <BackButton fallbackHref={`/products?store=${store.id}`} label="Retour aux produits" />
          <h1 className="page-title">{product.title}</h1>
          <p className="page-subtitle">{product.productType ?? "Catégorie non renseignée"} · statut Shopify : {product.status}</p>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <MetricCard label="OnDeal Score" value={scoreBreakdown ? `${scoreBreakdown.score}/100 (${scoreBreakdown.dataCompleteness}% de données disponibles)` : null} />
        <MetricCard label="Stock total" value={anyStockKnown ? String(totalStock) : null} />
        <MetricCard label="Note moyenne" value={avgRating !== null ? `${avgRating.toFixed(1)}/5 (${product.reviews.length} avis)` : null} />
      </div>

      {scoreBreakdown && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Détail du score — pourquoi ce chiffre ?</h2>
          <table className="table">
            <thead>
              <tr><th>Facteur</th><th>Disponible</th><th>Contribution</th></tr>
            </thead>
            <tbody>
              {scoreBreakdown.factors.map((f, i) => (
                <tr key={i}>
                  <td>{f.label}</td>
                  <td>
                    {f.available ? (
                      "Oui"
                    ) : (
                      <span className="unavailable-note">
                        Non disponible
                        {UNAVAILABLE_HINTS[f.label] && ` — ${UNAVAILABLE_HINTS[f.label]}`}
                      </span>
                    )}
                  </td>
                  <td>{f.contribution.toFixed(1)} pts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Variantes & stock</h2>
        <table className="table">
          <thead>
            <tr><th>Variante</th><th>SKU</th><th>Prix</th><th>Stock boutique</th><th>Stock fournisseur</th><th></th></tr>
          </thead>
          <tbody>
            {product.variants.map((v) => (
              <tr key={v.id}>
                <td>{v.title}</td>
                <td>{v.sku ?? "—"}</td>
                <td>{v.price !== null ? `${v.price.toFixed(2)} €` : <span className="unavailable-note">n/d</span>}</td>
                <td>{v.inventoryQuantity ?? <span className="unavailable-note">n/d</span>}</td>
                <td>{v.supplierStock ?? <span className="unavailable-note">n/d</span>}</td>
                <td>
                  <Link href={`/pricing/${v.id}?store=${store.id}`} className="btn btn-ghost btn-sm">
                    Prix &amp; coûts
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {product.recommendations.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Recommandations pour ce produit</h2>
          {product.recommendations.map((r) => {
            const meta = SEVERITY_META[r.severity as keyof typeof SEVERITY_META] ?? SEVERITY_META.SUGGESTION;
            return (
              <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span className={`badge badge-${meta.cls}`}>{meta.label}</span>
                  <span style={{ fontWeight: 700 }}>{r.title}</span>
                </div>
                <div style={{ fontSize: 13.5, color: "#6b6b85" }}>{r.reason}</div>
                <Link href={`/intelligence?store=${store.id}`} className="cell-sub" style={{ display: "inline-block", marginTop: 4 }}>
                  Voir dans Signaux →
                </Link>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Derniers avis réels</h2>
        {product.reviews.length === 0 ? (
          <p className="unavailable-note">Aucun avis pour ce produit.</p>
        ) : (
          product.reviews.map((r) => (
            <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ fontWeight: 700 }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)} {r.title ?? ""}</div>
              <div style={{ fontSize: 13.5, color: "#6b6b85" }}>{r.body}</div>
              <div style={{ fontSize: 12, color: "#9a9ab0", marginTop: 4 }}>
                {r.authorName ?? "Anonyme"} — {r.publishedAt.toLocaleDateString("fr-FR")}
                {r.verifiedPurchase ? " — Achat vérifié" : ""}
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
