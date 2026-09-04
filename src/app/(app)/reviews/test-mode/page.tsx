import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import TestModeGenerator from "@/components/TestModeGenerator";

export default async function TestModePage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);

  const products = await prisma.product.findMany({
    where: { storeId: store.id },
    select: { handle: true, title: true },
    take: 200,
  });

  return (
    <AppShell store={store} active="/reviews">
      <div className="callout callout-warning">
        <strong>MODE TEST — AVIS FICTIFS.</strong> Les avis générés ici sont entièrement fictifs et destinés
        uniquement aux tests techniques (ex. import CSV Judge.me). Ils ne doivent jamais être présentés comme des
        avis clients réels, et ne sont jamais importés automatiquement vers une boutique de production.
      </div>
      <TestModeGenerator storeId={store.id} products={products} />
    </AppShell>
  );
}
