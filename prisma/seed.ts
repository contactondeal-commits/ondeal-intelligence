import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// PHASE 22 — SaaS. Limites par plan, alignées sur l'offre commerciale
// définie par l'utilisateur :
//   Starter 19€/mois  — 1 boutique, catalogue, avis, stock, alertes, recommandations
//   Pro 49€/mois      — + intelligence prix/marge, marketing, IA, automatisations, rapports
//   Business 99€/mois — + multi-boutiques, fournisseurs, automatisations avancées, API, historique, équipe
//   Agency            — agences gérant plusieurs boutiques clientes (limites les plus larges)
// Le paiement n'est pas implémenté dans cette V1 (voir docs/SAAS.md) ; ces
// limites sont déjà appliquées côté application pour que l'ajout d'un
// fournisseur de paiement (Stripe...) n'exige pas de changement de modèle.
const PLAN_LIMITS = [
  { plan: "STARTER" as const, maxStores: 1, maxProducts: 1000, maxUsers: 1 },
  { plan: "PRO" as const, maxStores: 1, maxProducts: 10000, maxUsers: 3 },
  { plan: "BUSINESS" as const, maxStores: 10, maxProducts: 100000, maxUsers: 15 },
  { plan: "AGENCY" as const, maxStores: 100, maxProducts: 1000000, maxUsers: 100 },
];

async function main() {
  for (const limit of PLAN_LIMITS) {
    await prisma.planLimit.upsert({
      where: { plan: limit.plan },
      create: limit,
      update: limit,
    });
  }
  console.log(`Seed terminé : ${PLAN_LIMITS.length} plans configurés.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
