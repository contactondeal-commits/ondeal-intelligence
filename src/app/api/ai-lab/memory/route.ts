import { NextRequest, NextResponse } from "next/server";
import { CapabilityError, requireCapabilityWithOwnerSession } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { queryMemory, type MemoryScope } from "@/lib/ai/memory/store";

const VALID_SCOPES: MemoryScope[] = ["WORKING", "EPISODIC", "BRAND", "DESIGN", "ENGINEERING", "FAILURE", "OUTCOME", "MODEL_PERFORMANCE"];

/**
 * ONDEAL AI CORE — §57-60 "Persistent Memory foundation" (06/09/2026),
 * lecture RÉELLE (voir memory/store.ts pour l'écriture, câblée dans
 * graphRunner.ts — planning/échec de node/succès de mission). Alimente
 * l'onglet AI LAB → MEMORY (§90) : jamais une page décorative vide.
 */
export async function GET(req: NextRequest) {
  try {
    await requireCapabilityWithOwnerSession("AI_EVAL_READ");
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope");
  const scope = scopeParam && VALID_SCOPES.includes(scopeParam as MemoryScope) ? (scopeParam as MemoryScope) : undefined;
  const records = await queryMemory({ scope, limit: 100 });
  return NextResponse.json({ records });
}
