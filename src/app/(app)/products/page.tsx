import Link from "next/link";
import { Prisma } from "@prisma/client";
import { Package, Star, AlertTriangle, Coins, MessageSquare } from "lucide-react";
import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import Pagination from "@/components/ui/Pagination";
import TableControls from "@/components/ui/TableControls";
import DataTag from "@/components/ui/DataTag";
import { parsePageParams, withParams } from "@/lib/pagination";
import { classifyProduct } from "@/lib/intelligence/score";
import { salesWindowStart } from "@/lib/intelligence/salesWindow";

const TIER_META: Record<string, { label: string; cls: string }> = {
  a_booster: { label: "À promouvoir", cls: "badge-suggestion" },
  performant: { label: "Score élevé", cls: "badge-suggestion" },
  a_optimiser: { label: "À optimiser", cls: "badge-neutral" },
  a_surveiller: { label: "À surveiller", cls: "badge-opportunity" },
  a_revoir: { label: "À revoir", cls: "badge-urgent" },
};

type Params = { store?: string; q?: string; segment?: string; status?: string; sort?: string; page?: string; pageSize?: string };
type Sort = "score_desc" | "score_asc" | "sales_desc" | "stock_asc" | "updated" | "title";

// Segments = filtres RÉELS (chaque onglet correspond à une condition SQL vérifiable).
const SEGMENTS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Tous les produits" },
  { value: "sold30", label: "Vendus (30 j)" },
  { value: "rupture", label: "Ruptures" },
  { value: "nocost", label: "Sans coût réel" },
  { value: "noreview", label: "Sans avis" },
  { value: "draft", label: "Brouillons / archivés" },
];
const SORT_OPTIONS: Array<{ value: Sort; label: string }> = [
  { value: "score_desc", label: "Score décroissant" },
  { value: "score_asc", label: "Score croissant" },
  { value: "sales_desc", label: "Ventes 30 j" },
  { value: "stock_asc", label: "Stock croissant" },
  { value: "updated", label: "Dernière mise à jour" },
  { value: "title", label: "Nom du produit" },
];

/**
 * PRODUCT INTELLIGENCE — direction produit 03/09/2026 : tuiles réelles,
 * segments = filtres SQL réels, table compacte paginée (image, score,
 * ventes 30 j, marge brute, stock, avis, statut). Aucune tendance ni
 * sparkline : aucune série historique par produit n'existe encore.
 */
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const store = await requireStore(params);
  const { page, pageSize } = parsePageParams(params);
  const segment = SEGMENTS.some((s) => s.value === params.segment) ? (params.segment as string) : "all";
  const sort: Sort = SORT_OPTIONS.some((o) => o.value === params.sort) ? (params.sort as Sort) : "score_desc";
  const windowStart = salesWindowStart();

  const latestScore = Prisma.sql`(SELECT s.score FROM score_snapshots s WHERE s."storeId" = ${store.id} AND s."productId" = p.id ORDER BY s."computedAt" DESC LIMIT 1)`;
  const totalStock = Prisma.sql`(SELECT SUM(v."inventoryQuantity") FROM variants v WHERE v."productId" = p.id)`;
  const units30 = Prisma.sql`(SELECT COALESCE(SUM(ss."unitsSold"), 0) FROM sales_snapshots ss WHERE ss."productId" = p.id AND ss.date >= ${windowStart})`;

  const where: Prisma.Sql[] = [Prisma.sql`p."storeId" = ${store.id}`];
  if (params.q?.trim()) {
    const like = `%${params.q.trim()}%`;
    where.push(Prisma.sql`(p.title ILIKE ${like} OR p.handle ILIKE ${like} OR p.vendor ILIKE ${like} OR EXISTS (SELECT 1 FROM variants v WHERE v."productId" = p.id AND v.sku ILIKE ${like}))`);
  }
  switch (segment) {
    case "sold30":
      where.push(Prisma.sql`${units30} > 0`);
      break;
    case "rupture":
      where.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM variants v WHERE v."productId" = p.id AND v."inventoryQuantity" > 0)`);
      break;
    case "nocost":
      where.push(Prisma.sql`EXISTS (SELECT 1 FROM variants v WHERE v."productId" = p.id AND v."unitCost" IS NULL)`);
      break;
    case "noreview":
      where.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM reviews r WHERE r."productId" = p.id)`);
      break;
    case "draft":
      where.push(Prisma.sql`p.status <> 'active'`);
      break;
  }
  const whereSql = Prisma.join(where, " AND ");
  const order =
    sort === "score_asc"
      ? Prisma.sql`ORDER BY (${latestScore} IS NULL) ASC, ${latestScore} ASC, p.title ASC`
      : sort === "sales_desc"
        ? Prisma.sql`ORDER BY ${units30} DESC, p.title ASC`
        : sort === "stock_asc"
          ? Prisma.sql`ORDER BY ${totalStock} ASC, p.title ASC`
          : sort === "updated"
            ? Prisma.sql`ORDER BY p."updatedAt" DESC`
            : sort === "title"
              ? Prisma.sql`ORDER BY p.title ASC`
              : Prisma.sql`ORDER BY (${latestScore} IS NULL) ASC, ${latestScore} DESC, p.title ASC`;

  const [countRow, ids, tiles] = await Promise.all([
    prisma.$queryRaw<Array<{ c: number | bigint }>>(Prisma.sql`SELECT COUNT(*) AS c FROM products p WHERE ${whereSql}`),
    prisma.$queryRaw<Array<{ id: string; units30: number | bigint | null }>>(Prisma.sql`SELECT p.id, ${units30} AS units30 FROM products p WHERE ${whereSql} ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    prisma.$queryRaw<Array<{ active: number | bigint; avgScore: number | null; rupture: number | bigint; nocost: number | bigint; noreview: number | bigint; sold30: number | bigint }>>(Prisma.sql`
      SELECT
        SUM(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END) AS active,
        AVG(${latestScore}) AS "avgScore",
        SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM variants v WHERE v."productId" = p.id AND v."inventoryQuantity" > 0) THEN 1 ELSE 0 END) AS rupture,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM variants v WHERE v."productId" = p.id AND v."unitCost" IS NULL) THEN 1 ELSE 0 END) AS nocost,
        SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM reviews r WHERE r."productId" = p.id) THEN 1 ELSE 0 END) AS noreview,
        SUM(CASE WHEN ${units30} > 0 THEN 1 ELSE 0 END) AS sold30
      FROM products p WHERE p."storeId" = ${store.id}
    `),
  ]);
  const total = Number(countRow[0]?.c ?? 0);
  const t = tiles[0];
  const unitsById = new Map(ids.map((r) => [r.id, Number(r.units30 ?? 0)]));

  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        include: {
          variants: { select: { inventoryQuantity: true, unitCost: true, price: true, sku: true } },
          reviews: { select: { rating: true } },
          scoreSnapshots: { orderBy: { computedAt: "desc" }, take: 1, select: { score: true } },
        },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const ordered = ids.map((r) => byId.get(r.id)).filter((p): p is NonNullable<typeof p> => !!p);
  const urlParams: Record<string, string | undefined> = { store: store.id, q: params.q, segment, sort, pageSize: params.pageSize };

  return (
    <AppShell store={store} active="/products">
      <div className="topbar">
        <div>
          <h1 className="page-title">Product Intelligence</h1>
          <p className="page-subtitle">Analysez vos produits, détectez les opportunités et améliorez vos performances — données Shopify réelles, scores calculés.</p>
        </div>
      </div>

      <div className="stat-strip stat-strip-icons" role="list">
        <IconTile icon={<Package size={16} />} label="Produits actifs" value={Number(t?.active ?? 0).toLocaleString("fr-FR")} tag="real" hint={`${total.toLocaleString("fr-FR")} au total`} />
        <IconTile icon={<Star size={16} />} label="Score moyen" value={t?.avgScore != null ? `${Math.round(t.avgScore)}/100` : "—"} tag="calculated" hint="OnDeal Score, dernier calcul" />
        <IconTile icon={<Coins size={16} />} label="Vendus sur 30 j" value={Number(t?.sold30 ?? 0).toLocaleString("fr-FR")} tag="real" hint="produits avec au moins une vente" />
        <IconTile icon={<AlertTriangle size={16} />} label="Rupture de stock" value={Number(t?.rupture ?? 0).toLocaleString("fr-FR")} tag="real" tone="danger" hint="stock à 0 sur toutes les variantes" />
        <IconTile icon={<MessageSquare size={16} />} label="Sans avis" value={Number(t?.noreview ?? 0).toLocaleString("fr-FR")} tag="real" hint={`${Number(t?.nocost ?? 0).toLocaleString("fr-FR")} sans coût réel`} />
      </div>

      <nav className="segment-tabs" aria-label="Segments">
        {SEGMENTS.map((s) => (
          <Link key={s.value} href={`/products${withParams(urlParams, { segment: s.value === "all" ? undefined : s.value, page: undefined })}`} className={`segment-tab${segment === s.value ? " is-active" : ""}`} aria-current={segment === s.value ? "page" : undefined}>
            {s.label}
          </Link>
        ))}
      </nav>

      <div className="card card-table">
        <TableControls params={urlParams} searchPlaceholder="Rechercher un produit, un SKU, un vendor" filters={[]} sort={{ key: "sort", label: "Tri", value: sort, options: SORT_OPTIONS }} />
        <div className="table-scroll">
          <table className="table table-compact table-products">
            <thead>
              <tr>
                <th>Produit</th>
                <th className="num">
                  Score <DataTag status="calculated" compact />
                </th>
                <th className="num">
                  Ventes 30 j <DataTag status="real" compact />
                </th>
                <th className="num">
                  Marge brute <DataTag status="calculated" compact />
                </th>
                <th className="num">
                  Stock <DataTag status="real" compact />
                </th>
                <th className="num">Avis</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ordered.length === 0 && (
                <tr>
                  <td colSpan={8} className="unavailable-note" style={{ padding: 24, textAlign: "center" }}>
                    Aucun produit ne correspond à ces critères.
                  </td>
                </tr>
              )}
              {ordered.map((p) => {
                const score = p.scoreSnapshots[0]?.score ?? null;
                const stock = p.variants.reduce((s, v) => s + (v.inventoryQuantity ?? 0), 0);
                const anyStockKnown = p.variants.some((v) => v.inventoryQuantity !== null);
                const costed = p.variants.filter((v) => v.unitCost !== null && v.price !== null && v.price > 0);
                const grossRate = costed.length ? costed.reduce((s, v) => s + (v.price! - v.unitCost!) / v.price!, 0) / costed.length : null;
                const avgRating = p.reviews.length > 0 ? p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length : null;
                const tier = score !== null ? classifyProduct({ score, hasStockCritical: anyStockKnown && stock === 0, hasNegativeMargin: grossRate !== null && grossRate < 0, salesTrendPositive: null }) : null;
                const units = unitsById.get(p.id) ?? 0;
                const sku = p.variants.find((v) => v.sku)?.sku ?? null;
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="product-cell">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- image Shopify externe, taille fixe, pas d'optimisation Next nécessaire ici
                          <img src={p.imageUrl} alt="" width={36} height={36} className="product-thumb" loading="lazy" />
                        ) : (
                          <span className="product-thumb product-thumb-empty" aria-hidden="true">
                            <Package size={14} />
                          </span>
                        )}
                        <div className="product-cell-body">
                          <div className="cell-title">{p.title}</div>
                          <div className="cell-sub cell-sub-clip">
                            {p.variants.length} variante{p.variants.length > 1 ? "s" : ""}
                            {sku ? ` · SKU ${sku}` : ""}
                            {p.status !== "active" ? ` · ${p.status}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{score !== null ? <span className={`score-chip ${score >= 70 ? "is-good" : score >= 50 ? "is-mid" : "is-low"}`}>{score}</span> : <span className="cell-sub">n/d</span>}</td>
                    <td className="num">
                      {units.toLocaleString("fr-FR")}
                      <div className="cell-sub">unités</div>
                    </td>
                    <td className={`num ${grossRate !== null && grossRate < 0 ? "is-negative" : ""}`}>
                      {grossRate !== null ? `${(grossRate * 100).toFixed(0)} %` : <span className="cell-sub">n/d</span>}
                      <div className="cell-sub">
                        {costed.length}/{p.variants.length} costées
                      </div>
                    </td>
                    <td className="num">
                      {anyStockKnown ? stock.toLocaleString("fr-FR") : <span className="cell-sub">n/d</span>}
                      <div className={`cell-sub ${anyStockKnown && stock === 0 ? "is-negative" : ""}`}>{anyStockKnown ? (stock === 0 ? "Rupture" : stock <= 20 ? "Faible" : "Disponible") : ""}</div>
                    </td>
                    <td className="num">{avgRating !== null ? `${avgRating.toFixed(1)} (${p.reviews.length})` : <span className="cell-sub">aucun</span>}</td>
                    <td>{tier ? <span className={`badge ${TIER_META[tier]!.cls}`}>{TIER_META[tier]!.label}</span> : "—"}</td>
                    <td>
                      <Link href={`/products/${p.id}?store=${store.id}`} className="btn btn-secondary btn-sm">
                        Détail
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} pageSize={pageSize} params={urlParams} label="produits" />
      </div>
    </AppShell>
  );
}

function IconTile({ icon, label, value, tag, hint, tone }: { icon: React.ReactNode; label: string; value: string; tag: "real" | "calculated" | "estimated" | "unavailable"; hint?: string; tone?: "danger" | "warning" }) {
  return (
    <div className={`stat-tile stat-tile-icon${tone ? ` stat-tile-${tone}` : ""}`} role="listitem">
      <span className="stat-tile-glyph" aria-hidden="true">
        {icon}
      </span>
      <div>
        <div className="stat-tile-label">
          {label} <DataTag status={tag} compact />
        </div>
        <div className="stat-tile-value">{value}</div>
        {hint && <div className="stat-tile-hint">{hint}</div>}
      </div>
    </div>
  );
}
