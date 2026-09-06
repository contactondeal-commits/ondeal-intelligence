import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, WRITE_ROLES, requireRole, requireStoreAccess } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getJobForStore, requestCancellation } from "@/lib/ai/jobs/store";

// ONDEAL AI JOB ENGINE — consultation de statut + annulation coopérative
// (06/09/2026). GET est en lecture seule (tout rôle avec accès à la
// boutique) ; PATCH ne fait QUE poser le flag cancelRequested — le worker
// (src/lib/ai/jobs/worker.ts) le vérifie entre deux steps, jamais une
// coupure forcée d'un process externe (voir commentaire schema.prisma sur
// Job.cancelRequested).

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const storeId = req.nextUrl.searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "storeId requis." }, { status: 400 });

  try {
    await requireStoreAccess(storeId);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const job = await getJobForStore(jobId, storeId);
  if (!job) return NextResponse.json({ error: "Job introuvable pour cette boutique." }, { status: 404 });

  return NextResponse.json({
    id: job.id,
    type: job.type,
    status: job.status,
    currentStepIndex: job.currentStepIndex,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    result: job.resultJson ? JSON.parse(job.resultJson) : null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    steps: job.steps.map((s) => ({
      index: s.index,
      attempt: s.attempt,
      name: s.name,
      status: s.status,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
    })),
  });
}

const patchSchema = z.object({ storeId: z.string().min(1).max(64), action: z.literal("cancel") }).strict();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  const { storeId } = parsed.data;

  let userId: string;
  try {
    const access = await requireStoreAccess(storeId);
    userId = access.userId;
    requireRole(access.role, WRITE_ROLES);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const cancelled = await requestCancellation(jobId, storeId);
  if (!cancelled) return NextResponse.json({ error: "Job introuvable pour cette boutique." }, { status: 404 });

  await logAudit({ storeId, userId, actorType: "user", event: "job.cancel_requested", message: `Annulation demandée pour le job ${jobId}.`, meta: { jobId } });

  return NextResponse.json({ ok: true });
}
