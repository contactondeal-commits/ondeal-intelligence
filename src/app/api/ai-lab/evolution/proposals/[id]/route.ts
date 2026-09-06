import { NextResponse } from "next/server";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { getProposal } from "@/lib/ai/evolution/proposals";

/** ONDEAL AI CORE — §61-65 "System Evolution Console" — détail d'une proposition. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireCapabilityWithOwnerSession("AI_EVAL_READ");
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const { id } = await params;
  const proposal = await getProposal(id);
  if (!proposal) return NextResponse.json({ error: "EvolutionProposal introuvable." }, { status: 404 });
  return NextResponse.json({ proposal });
}
