import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, verifyPassword, clearSessionCookie } from "@/lib/auth";

const schema = z.object({
  password: z.string().min(1),
  // Saisie exacte exigée côté client — évite une suppression accidentelle
  // par un simple clic (action irréversible).
  confirmation: z.literal("SUPPRIMER"),
});

/**
 * RGPD — droit à l'effacement (art. 17), libre-service (audit conformité
 * 05/09/2026). Action IRRÉVERSIBLE, protégée par : session valide + mot de
 * passe re-saisi + confirmation textuelle exacte.
 *
 * Règle de suppression, par organisation dont l'utilisateur est membre :
 *   - s'il en est l'UNIQUE membre (peu importe le rôle) → l'organisation
 *     entière est supprimée (cascade Prisma : boutiques, intégrations,
 *     produits, commandes, actions, historique — voir schema.prisma).
 *   - s'il y a D'AUTRES membres → l'organisation et ses données NE SONT
 *     JAMAIS supprimées (ce serait supprimer le espace de travail
 *     d'autrui) : seule l'appartenance de cet utilisateur y est retirée.
 *     Cas particulier (propriétaire unique restant d'autres membres non-
 *     propriétaires) : journalisé pour suivi manuel plutôt que bloqué —
 *     le transfert de propriété n'existe pas encore dans cette version.
 * Le compte (User) est ensuite supprimé : ses Membership restantes sont
 * supprimées en cascade, et ses entrées AuditLog passées sont conservées
 * mais anonymisées (userId → null, onDelete: SetNull) pour ne pas trouer
 * l'historique d'audit des boutiques partagées.
 */
export async function POST(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Mot de passe et confirmation ('SUPPRIMER') requis." },
      { status: 400 },
    );
  }

  const userRow = await prisma.user.findUnique({ where: { id: current.user.id } });
  if (!userRow) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  }
  const passwordOk = await verifyPassword(parsed.data.password, userRow.passwordHash);
  if (!passwordOk) {
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }

  const memberships = await prisma.membership.findMany({
    where: { userId: userRow.id },
    include: { organization: { include: { _count: { select: { memberships: true } }, stores: { select: { id: true } } } } },
  });

  await prisma.$transaction(async (tx) => {
    for (const m of memberships) {
      const soleMember = m.organization._count.memberships <= 1;
      const firstStoreId = m.organization.stores[0]?.id;

      if (soleMember) {
        if (firstStoreId) {
          await tx.auditLog.create({
            data: {
              storeId: firstStoreId,
              userId: userRow.id,
              actorType: "user",
              event: "gdpr.account_deletion",
              message: `Suppression de compte demandée par ${userRow.email} — organisation "${m.organization.name}" supprimée (aucun autre membre).`,
            },
          });
        }
        await tx.organization.delete({ where: { id: m.organizationId } });
      } else if (firstStoreId) {
        await tx.auditLog.create({
          data: {
            storeId: firstStoreId,
            userId: userRow.id,
            actorType: "user",
            event: "gdpr.member_left",
            message: `Suppression de compte demandée par ${userRow.email} — retrait de l'organisation "${m.organization.name}" (d'autres membres y restent, données conservées).${m.role === "OWNER" ? " Attention : ce compte en était propriétaire (OWNER) — vérifier qu'un autre membre reprend ce rôle." : ""}`,
          },
        });
      }
      // Si soleMember est faux, on NE supprime PAS l'organisation : la
      // Membership de cet utilisateur sera supprimée en cascade avec le
      // User ci-dessous, sans toucher au reste de l'organisation.
    }

    await tx.user.delete({ where: { id: userRow.id } });
  });

  await clearSessionCookie();

  return NextResponse.json({ ok: true });
}
