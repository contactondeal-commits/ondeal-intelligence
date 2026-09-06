import { NextRequest, NextResponse } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { buildMissionDetailPayload } from "@/lib/ai/supervisor/missionDetail";

/** ONDEAL AI CORE — PHASE 5 : détail complet d'une mission (graphe + artefacts + audit + pièces jointes) — Owner uniquement. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const payload = await buildMissionDetailPayload(id);
  if (!payload) return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
  return NextResponse.json(payload);
}
