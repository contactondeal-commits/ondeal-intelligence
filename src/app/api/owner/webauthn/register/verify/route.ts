import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/authz/capabilities";
import { verifyRegistration } from "@/lib/authz/webauthn";
import { createOwnerSession } from "@/lib/authz/ownerSession";
import { generateRecoveryCodes } from "@/lib/authz/recovery";
import { prisma } from "@/lib/db";
import { appendAuditLog } from "@/lib/ai/policy/audit";

const bodySchema = z.object({ deviceLabel: z.string().min(1).max(120), response: z.unknown() }).strict();

// Vérifie l'attestation WebAuthn RÉELLE renvoyée par le navigateur, persiste
// la clé publique, ouvre une PlatformOwnerSession (L2_PASSKEY), et — SI ET
// SEULEMENT SI c'est la toute première clé de cet Owner — génère 10 codes de
// récupération affichés UNE SEULE FOIS dans cette réponse (jamais journalisés,
// jamais récupérables ensuite).
export async function POST(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!isPlatformOwner(current.user.id)) return NextResponse.json({ error: "Réservé au Platform Owner." }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });

  const wasFirstCredential = (await prisma.platformOwnerCredential.count({ where: { userId: current.user.id, revokedAt: null } })) === 0;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await verifyRegistration(current.user.id, parsed.data.deviceLabel, parsed.data.response as any);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const credential = await prisma.platformOwnerCredential.findFirst({ where: { userId: current.user.id }, orderBy: { createdAt: "desc" } });
  await createOwnerSession(current.user.id, credential!.credentialId);

  const recoveryCodes = wasFirstCredential ? await generateRecoveryCodes(current.user.id) : null;

  await appendAuditLog({
    actorUserId: current.user.id,
    action: "owner.webauthn_credential_registered",
    reason: `Clé WebAuthn "${parsed.data.deviceLabel}" enregistrée pour le Platform Owner (première clé : ${wasFirstCredential}).`,
    resultStatus: "SUCCESS",
  });

  return NextResponse.json({ ok: true, recoveryCodes });
}
