import { prisma } from "@/lib/db";

/**
 * Journal d'activité (PHASE 14). Chaque événement significatif du pipeline
 * DONNÉES → ANALYSE → INTELLIGENCE → RECOMMANDATION → VALIDATION → ACTION →
 * VÉRIFICATION doit être tracé ici pour rester compréhensible a posteriori.
 */
export async function logAudit(params: {
  storeId: string;
  userId?: string | null;
  actorType: "user" | "system";
  event: string;
  message: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      storeId: params.storeId,
      userId: params.userId ?? null,
      actorType: params.actorType,
      event: params.event,
      message: params.message,
      metaJson: params.meta ? JSON.stringify(params.meta) : null,
    },
  });
}
