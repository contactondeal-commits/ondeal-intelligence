import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import BackButton from "@/components/BackButton";
import DecisionCard from "@/components/DecisionCard";
import { groupRecommendations, type GroupableRecommendation, type RecommendationGroup } from "@/lib/intelligence/group";
import { lightenGroup } from "@/lib/intelligence/groupTransport";
import { fetchDeferredPriceMeasurement } from "@/lib/intelligence/measurementEvidence";

const CATEGORY_LABEL: Record<string, string> = {
  margin: "Marge",
  stock: "Stock",
  reviews: "Preuve sociale",
  data_quality: "Qualité des données",
  content: "Contenu produit",
  marketing: "Marketing",
};

/**
 * Decision Workspace générique (lot 7, 05/09/2026) — une page dédiée par
 * décision, pour TOUTE catégorie de recommandation (le prix a déjà sa
 * propre fiche plus riche sur /pricing/[variantId] ; celle-ci couvre stock,
 * avis, marketing, qualité de données — tout ce qui n'avait jusqu'ici
 * aucune page dédiée et ne se vivait que noyé dans une liste).
 *
 * N'assemble RIEN de nouveau : réutilise le DecisionCard existant (même
 * moteur d'état, mêmes appels /api/actions) et groupRecommendations (mêmes
 * clés de regroupement que le Centre d'intelligence) — seule la mise en
 * page change (une page entière au lieu d'une carte dans une liste), avec
 * un permalien stable par recommandation.
 */
export default async function DecisionWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ recommendationId: string }>;
  searchParams: Promise<{ store?: string }>;
}) {
  const store = await requireStore(await searchParams);
  const { recommendationId } = await params;

  const recommendation = await prisma.recommendation.findFirst({
    where: { id: recommendationId, storeId: store.id },
    include: { product: { select: { id: true, title: true } } },
  });
  if (!recommendation) notFound();

  // Si le signal est encore ouvert, on reconstruit EXACTEMENT le même groupe
  // que le Centre d'intelligence (même fonction, même tri) pour que cette
  // page et la liste montrent toujours la même chose. Une fois la décision
  // prise (ACTIONED/DISMISSED), la recommandation n'est plus dans l'ensemble
  // "OPEN" : le regroupement par produit n'aurait alors plus de sens (les
  // autres signaux du groupe ont pu changer depuis) — on affiche un groupe à
  // un seul élément, qui reste l'état honnête de CETTE décision précise.
  let group: RecommendationGroup;
  if (recommendation.status === "OPEN") {
    const siblings: GroupableRecommendation[] = recommendation.productId
      ? await prisma.recommendation.findMany({
          where: { storeId: store.id, status: "OPEN", category: recommendation.category, productId: recommendation.productId },
          include: { product: { select: { id: true, title: true } } },
        })
      : [recommendation];
    const groups = groupRecommendations(siblings);
    group = groups.find((g) => g.items.some((i) => i.id === recommendation.id)) ?? singletonGroup(recommendation);
  } else {
    group = singletonGroup(recommendation);
  }

  const itemIds = group.items.map((i) => i.id);
  const existingActions = itemIds.length
    ? await prisma.actionItem.findMany({ where: { storeId: store.id, recommendationId: { in: itemIds } }, orderBy: { createdAt: "desc" } })
    : [];
  const latestByRec = new Map<string, (typeof existingActions)[number]>();
  for (const a of existingActions) if (a.recommendationId && !latestByRec.has(a.recommendationId)) latestByRec.set(a.recommendationId, a);
  const actionsByRecommendation: Record<
    string,
    { id: string; type: string; sensitivity: "SENSITIVE" | "SAFE"; status: (typeof existingActions)[number]["status"]; payload: Record<string, unknown>; resultJson: string | null; createdAt: string; confirmedAt: string | null; executedAt: string | null }
  > = {};
  for (const [recId, a] of latestByRec) {
    actionsByRecommendation[recId] = {
      id: a.id,
      type: a.type,
      sensitivity: a.sensitivity as "SENSITIVE" | "SAFE",
      status: a.status,
      payload: JSON.parse(a.payloadJson) as Record<string, unknown>,
      resultJson: a.resultJson,
      createdAt: a.createdAt.toISOString(),
      confirmedAt: a.confirmedAt?.toISOString() ?? null,
      executedAt: a.executedAt?.toISOString() ?? null,
    };
  }

  // Lot 8 (05/09/2026) — Impact réel vs estimé : pour une action de prix
  // déjà exécutée, la mesure comptable (measurement) est persistée telle
  // quelle depuis l'exécution, mais son sous-champ `deferred` (effet réel
  // sur les ventes) y est figé pour toujours à "insufficient_data" — à
  // l'instant de l'exécution, "après" n'existe pas encore. On le RECALCULE
  // ici, en direct, à partir des vraies commandes reçues depuis, à chaque
  // consultation de cette page — jamais stocké, jamais une tâche de fond.
  await Promise.all(
    Object.values(actionsByRecommendation)
      .filter((a) => a.status === "EXECUTED" && a.type === "update_price" && a.resultJson && a.executedAt)
      .map(async (a) => {
        try {
          const parsed = JSON.parse(a.resultJson!) as Record<string, unknown>;
          const measurement = parsed.measurement as Record<string, unknown> | undefined;
          const variantId = typeof a.payload.variantId === "string" ? a.payload.variantId : null;
          if (!measurement || !variantId) return;
          const deferred = await fetchDeferredPriceMeasurement({ storeId: store.id, variantId, executedAt: new Date(a.executedAt!) });
          parsed.measurement = { ...measurement, deferred };
          a.resultJson = JSON.stringify(parsed);
        } catch {
          // resultJson illisible ou mesure absente : enrichissement optionnel, jamais un plantage de la page pour ça.
        }
      }),
  );

  const backHref = `/intelligence?store=${store.id}`;

  return (
    <AppShell store={store} active="/intelligence">
      <div className="topbar">
        <div>
          <BackButton fallbackHref={backHref} />
          <div className="breadcrumb">
            <Link href={backHref}>Centre d&apos;intelligence</Link> <span aria-hidden="true">/</span>{" "}
            <span>{CATEGORY_LABEL[recommendation.category] ?? recommendation.category}</span>
          </div>
          <h1 className="page-title">{group.title}</h1>
          <p className="page-subtitle">
            Decision Workspace — signal, données réelles, scénario simulé, validation humaine puis résultat, réunis sur une seule page.
            {recommendation.status !== "OPEN" && " Cette décision a déjà été traitée : la page affiche son état final."}
          </p>
        </div>
      </div>

      <DecisionCard
        group={lightenGroup(group, 25)}
        storeId={store.id}
        existingAction={actionsByRecommendation[group.representative.id] ?? null}
        actionsByRecommendation={actionsByRecommendation}
        hideWorkspaceLink
      />
    </AppShell>
  );
}

function singletonGroup(r: GroupableRecommendation): RecommendationGroup {
  return {
    key: `${r.category}:${r.id}`,
    category: r.category,
    severity: r.severity,
    product: r.product ?? null,
    items: [r],
    title: r.title,
    confidence: r.confidence,
    representative: r,
    impactScore: r.impactScore ?? null,
    impactCoverage: r.impactScore != null ? 1 : 0,
  };
}
