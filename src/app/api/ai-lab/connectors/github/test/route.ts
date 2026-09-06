import { NextResponse } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { githubHealthCheck } from "@/lib/ai/connectors/github";

// Re-vérification RÉELLE à la demande (Owner clique "Test") — pas de step-up
// requis ici (lecture seule, aucun effet), contrairement à connect/disconnect.
export async function POST() {
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const health = await githubHealthCheck();
  return NextResponse.json(health);
}
