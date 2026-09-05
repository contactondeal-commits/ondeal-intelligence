import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import FeatureUnavailable from "@/components/FeatureUnavailable";
import { hasFeature } from "@/lib/plan-limits";
import AssistantChat from "@/components/AssistantChat";

const SUGGESTED_QUESTIONS = [
  "Que dois-je faire aujourd'hui ?",
  "Quels produits risquent une rupture ?",
  "Quels produits ont une mauvaise marge ?",
  "Pourquoi mes ventes baissent-elles ?",
  "Quels produits dois-je promouvoir ?",
  "Quels produits dois-je mettre sur l'accueil ?",
  "Quels produits n'ont pas assez d'avis ?",
  "Donne-moi mes 10 priorités.",
];

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; q?: string; productId?: string }>;
}) {
  const sp = await searchParams;
  const store = await requireStore(sp);
  if (!hasFeature(store.plan, "assistant")) {
    return (
      <AppShell store={store} active="/assistant">
        <FeatureUnavailable feature="OnDeal AI" plan={store.plan} storeId={store.id} />
      </AppShell>
    );
  }

  // LOT 10 (05/09/2026) — Copilot contextuel : la barre de commande ou une
  // fiche produit peuvent amener ici avec une question pré-remplie (`q`,
  // corrigeait un vrai bug — ce paramètre était jusqu'ici silencieusement
  // ignoré par cette page) et/ou un produit de contexte (`productId`).
  // Toujours revérifié comme appartenant à CETTE boutique avant d'être
  // affiché ou transmis — jamais fait confiance à la seule query string.
  const contextProduct = sp.productId
    ? await prisma.product.findFirst({ where: { id: sp.productId, storeId: store.id }, select: { id: true, title: true } })
    : null;

  return (
    <AppShell store={store} active="/assistant">
      <h1 className="page-title">Demandez à OnDeal Intelligence</h1>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>
        Répond uniquement à partir de vos données réelles déjà calculées. Ne prétend jamais avoir accès à une
        donnée indisponible.
      </p>
      <AssistantChat
        storeId={store.id}
        suggested={SUGGESTED_QUESTIONS}
        initialQuestion={sp.q ?? null}
        contextProduct={contextProduct}
      />
    </AppShell>
  );
}
