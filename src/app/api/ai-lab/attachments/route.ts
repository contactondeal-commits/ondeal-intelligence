import { NextRequest, NextResponse } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { ingestAttachment, listAttachments } from "@/lib/ai/attachments/store";
import { appendAuditLog } from "@/lib/ai/policy/audit";

/**
 * ONDEAL AI CORE — PHASE 5 : upload de pièce jointe (§"File Intelligence").
 * multipart/form-data, champ "file" — standalone (missionId null), attachée
 * ensuite via POST /api/ai-lab/missions (attachmentIds).
 */
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireCapability("SYSTEM_CODER"));
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) return NextResponse.json({ error: "Champ \"file\" manquant ou invalide (multipart/form-data attendu)." }, { status: 400 });

  const data = Buffer.from(await file.arrayBuffer());
  try {
    const row = await ingestAttachment({ filename: file.name, mimeType: file.type || "application/octet-stream", data, uploadedByUserId: userId });
    await appendAuditLog({ actorUserId: userId, action: "attachment_upload", reason: `Fichier "${row.filename}" (${row.kind}, ${row.sizeBytes} octets) — parseStatus=${row.parseStatus}.`, resultStatus: row.parseStatus === "FAILED" ? "FAILURE" : "SUCCESS" });
    return NextResponse.json({ attachment: { id: row.id, filename: row.filename, kind: row.kind, sizeBytes: row.sizeBytes, parseStatus: row.parseStatus, parseError: row.parseError } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const attachments = await listAttachments();
  return NextResponse.json({ attachments: attachments.map((a) => ({ id: a.id, filename: a.filename, kind: a.kind, sizeBytes: a.sizeBytes, parseStatus: a.parseStatus, missionId: a.missionId, createdAt: a.createdAt })) });
}
