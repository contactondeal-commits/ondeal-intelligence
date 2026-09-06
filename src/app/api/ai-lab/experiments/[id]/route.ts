import { NextResponse } from "next/server";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { getExperiment } from "@/lib/ai/experiments/run";

/** ONDEAL AI CORE — §51 "Experiment Mode" (06/09/2026) — détail d'un Experiment. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireCapabilityWithOwnerSession("AI_EVAL_READ");
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const { id } = await params;
  const experiment = await getExperiment(id);
  if (!experiment) return NextResponse.json({ error: "Experiment introuvable." }, { status: 404 });
  return NextResponse.json({ experiment });
}
