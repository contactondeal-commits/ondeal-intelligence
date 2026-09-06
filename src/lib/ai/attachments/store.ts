import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { classifyAttachment, parseAttachment } from "@/lib/ai/attachments/parse";

/**
 * ONDEAL AI CORE — PHASE 5 : File Intelligence — pipeline complet (06/09/2026).
 *
 * upload → stockage réel sur disque (storageRef, jamais le contenu en base,
 * même principe que CoderMissionArtifact.storageRef) → extraction réelle
 * (parse.ts) → persistance de la ligne AiLabAttachment avec provenance.
 * Standalone à l'upload (missionId null) — voir schema.prisma. Une taille
 * maximale RÉELLE est appliquée (jamais un upload illimité qui pourrait
 * épuiser le disque du sandbox).
 */

const STORAGE_ROOT = "/tmp/ondeal-ai-lab-attachments";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 Mo — borne réelle, cohérente avec les artefacts Coder Agent (captures/diff), jamais un upload illimité

export async function ingestAttachment(params: { filename: string; mimeType: string; data: Buffer; uploadedByUserId: string }) {
  if (params.data.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`Fichier "${params.filename}" (${params.data.byteLength} octets) dépasse la limite réelle de ${MAX_UPLOAD_BYTES} octets — refusé, jamais tronqué silencieusement à l'upload.`);
  }

  const kind = classifyAttachment(params.filename, params.mimeType);
  const dir = path.join(STORAGE_ROOT, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  const storageRef = path.join(dir, params.filename);
  await fs.writeFile(storageRef, params.data);

  const parsed = await parseAttachment(kind, params.data);

  const row = await prisma.aiLabAttachment.create({
    data: {
      filename: params.filename,
      mimeType: params.mimeType,
      sizeBytes: params.data.byteLength,
      storageRef,
      kind,
      parseStatus: parsed.status,
      parseError: parsed.error,
      extractedText: parsed.extractedText,
      uploadedByUserId: params.uploadedByUserId,
    },
  });
  return row;
}

export async function attachToMission(attachmentId: string, missionId: string) {
  return prisma.aiLabAttachment.update({ where: { id: attachmentId }, data: { missionId } });
}

export async function listAttachments(missionId?: string) {
  return prisma.aiLabAttachment.findMany({
    where: missionId ? { missionId } : undefined,
    orderBy: { createdAt: "desc" },
  });
}
