import { requireStore } from "@/lib/store-context";
import AppShell from "@/components/AppShell";
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

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);

  return (
    <AppShell store={store} active="/assistant">
      <h1 className="page-title">Demandez à OnDeal Intelligence</h1>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>
        Répond uniquement à partir de vos données réelles déjà calculées. Ne prétend jamais avoir accès à une
        donnée indisponible.
      </p>
      <AssistantChat storeId={store.id} suggested={SUGGESTED_QUESTIONS} />
    </AppShell>
  );
}
