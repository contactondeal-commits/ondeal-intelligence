import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CapabilityError, requireCapabilityWithStepUp } from "@/lib/authz/capabilities";
import { OwnerAuthError } from "@/lib/authz/ownerSession";
import { connectGithub, GithubConnectorError } from "@/lib/ai/connectors/github";
import { appendAuditLog } from "@/lib/ai/policy/audit";

const bodySchema = z.object({ token: z.string().min(10).max(500), repoFullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "Format attendu : owner/repo") }).strict();

// §44/§45 : connecter un jeton est une action sensible (accès en lecture,
// potentiellement écriture, au dépôt source d'OnDeal) — exige step-up.
// Le jeton est VÉRIFIÉ RÉELLEMENT (appel API GitHub) avant d'être chiffré
// et persisté — jamais enregistré à l'aveugle (§"NO FAKE CONNECTOR").
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides.", details: parsed.error.flatten() }, { status: 400 });

  let userId: string;
  try {
    ({ userId } = await requireCapabilityWithStepUp("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError || err instanceof OwnerAuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  try {
    const { scopes, login } = await connectGithub(parsed.data.token, parsed.data.repoFullName, userId);
    await appendAuditLog({ actorUserId: userId, connectorId: "github", action: "connector_connect", reason: `Connecteur GitHub connecté (compte "${login}", dépôt "${parsed.data.repoFullName}", scopes: ${scopes.join(",") || "aucun déclaré"}).`, resultStatus: "SUCCESS" });
    return NextResponse.json({ ok: true, login, scopes });
  } catch (err) {
    const message = err instanceof GithubConnectorError ? err.message : "Échec de connexion au dépôt GitHub.";
    await appendAuditLog({ actorUserId: userId, connectorId: "github", action: "connector_connect", reason: message, resultStatus: "FAILURE" });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
