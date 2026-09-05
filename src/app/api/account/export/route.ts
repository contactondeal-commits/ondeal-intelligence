import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Plafond par collection — protège la route (et le navigateur du
// marchand) d'un export démesuré pour un catalogue très volumineux. Le
// dépassement est signalé explicitement (`truncated: true`), jamais
// silencieux ; les données au-delà restent accessibles sur demande à
// contact@ondeal.fr (voir Paramètres > Confidentialité & légal).
const ROW_CAP = 2000;

/**
 * RGPD — droit d'accès et de portabilité (art. 15 et 20), libre-service
 * (audit conformité 05/09/2026). Exporte en JSON structuré : le profil du
 * compte, chaque organisation dont l'utilisateur est membre (rôle inclus),
 * et — pour les organisations dont il est PROPRIÉTAIRE (OWNER) — le détail
 * des boutiques qui lui appartiennent réellement (aucun identifiant
 * chiffré/secret n'est jamais inclus : voir exclusions ci-dessous).
 *
 * Volontairement EXCLUS de cet export : `passwordHash` (jamais exposé, même
 * au titulaire du compte), `encryptedCredentials` des intégrations (jetons
 * d'accès boutiques tierces — un export ne doit jamais redonner un moyen
 * d'accéder à un système tiers).
 */
export async function GET() {
  const current = await getCurrentUser();
  if (!current) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: current.user.id },
    select: { id: true, email: true, name: true, createdAt: true, updatedAt: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  }

  const organizations = await Promise.all(
    current.memberships.map(async (m) => {
      const isOwner = m.role === "OWNER";
      if (!isOwner) {
        // Membre simple (pas propriétaire) : pas de dump du contenu de la
        // boutique d'autrui — seulement l'appartenance elle-même, qui est
        // bien une donnée personnelle du titulaire du compte.
        return { organizationId: m.organizationId, organizationName: m.organizationName, role: m.role };
      }

      const stores = await prisma.store.findMany({
        where: { organizationId: m.organizationId },
        select: {
          id: true,
          name: true,
          domain: true,
          currency: true,
          isDemo: true,
          createdAt: true,
          integrations: { select: { provider: true, status: true, lastSyncedAt: true, lastError: true } },
          _count: { select: { products: true, orders: true, actions: true, costAssumptions: true } },
        },
      });

      const storesWithData = await Promise.all(
        stores.map(async (s) => {
          const [products, costAssumptions, actions] = await Promise.all([
            prisma.product.findMany({
              where: { storeId: s.id },
              take: ROW_CAP,
              select: { id: true, title: true, handle: true, status: true, vendor: true, productType: true, createdAtShopify: true },
            }),
            prisma.costAssumption.findMany({
              where: { storeId: s.id },
              take: ROW_CAP,
              select: { productId: true, supplierCost: true, shippingCost: true, paymentFeesRate: true, otherFixedCost: true, updatedAt: true },
            }),
            prisma.actionItem.findMany({
              where: { storeId: s.id },
              take: ROW_CAP,
              orderBy: { createdAt: "desc" },
              select: { id: true, type: true, sensitivity: true, status: true, createdAt: true, confirmedAt: true, executedAt: true },
            }),
          ]);
          return {
            id: s.id,
            name: s.name,
            domain: s.domain,
            currency: s.currency,
            isDemo: s.isDemo,
            createdAt: s.createdAt,
            integrations: s.integrations,
            counts: s._count,
            products: { rows: products, truncated: s._count.products > ROW_CAP },
            costAssumptions: { rows: costAssumptions, truncated: s._count.costAssumptions > ROW_CAP },
            actions: { rows: actions, truncated: s._count.actions > ROW_CAP },
          };
        }),
      );

      return {
        organizationId: m.organizationId,
        organizationName: m.organizationName,
        role: m.role,
        stores: storesWithData,
      };
    }),
  );

  const auditLogs = await prisma.auditLog.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: ROW_CAP,
    select: { storeId: true, actorType: true, event: true, message: true, createdAt: true },
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    meta: {
      note:
        "Export libre-service RGPD (art. 15 et 20) — OnDeal Intelligence. Les jetons d'accès aux intégrations connectées ne sont jamais inclus. Un export plus complet (au-delà des plafonds indiqués par 'truncated') peut être demandé à contact@ondeal.fr.",
      rowCapPerCollection: ROW_CAP,
    },
    profile: user,
    organizations,
    auditLogEntriesForThisUser: { rows: auditLogs, truncated: auditLogs.length >= ROW_CAP },
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ondeal-export-${user.id}.json"`,
    },
  });
}
