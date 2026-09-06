import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, WRITE_ROLES, requireRole, requireStoreAccess } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createJob } from "@/lib/ai/jobs/store";

// ONDEAL AI JOB ENGINE — fondation (06/09/2026). Cette route ne fait QUE
// créer la ligne Job (statut QUEUED) — elle ne l'exécute jamais elle-même
// (voir src/lib/ai/jobs/worker.ts : le worker boundary est un composant
// séparé, pas cette route). `type` reste une string libre, jamais validée
// contre une liste fermée ici — chaque appelant futur (un endpoint dédié,
// par type de tâche) est responsable de la forme de son propre `input`.
const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    type: z.string().min(1).max(64),
    input: z.unknown(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const { storeId, type, input, maxAttempts } = parsed.data;

  let userId: string;
  try {
    const access = await requireStoreAccess(storeId);
    userId = access.userId;
    requireRole(access.role, WRITE_ROLES);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const job = await createJob({ storeId, type, input, createdByUserId: userId, maxAttempts });

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "job.created",
    message: `Job "${type}" créé (${job.id}).`,
    meta: { jobId: job.id, type },
  });

  return NextResponse.json({ id: job.id, status: job.status, createdAt: job.createdAt }, { status: 201 });
}
