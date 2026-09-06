import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — PHASE 5 : Audit Trail AI Lab (06/09/2026), §13.
 *
 * Append-only par convention de code (aucune fonction update/delete
 * exportée ici) — voir AiLabAuditLog dans schema.prisma. Jamais un secret
 * en clair dans `reason`/les champs libres (appelants : ne JAMAIS y
 * interpoler encryptedCredentials ni un token).
 */
export async function appendAuditLog(entry: {
  missionId?: string;
  nodeKey?: string;
  actorUserId?: string | null;
  agentRole?: string;
  provider?: string;
  model?: string;
  toolId?: string;
  connectorId?: string;
  storeId?: string;
  action: string;
  decision?: "ALLOW_AUTO" | "REQUIRE_APPROVAL" | "DENY";
  riskClass?: string;
  reason: string;
  costUsd?: number;
  resultStatus?: "SUCCESS" | "FAILURE" | "DENIED";
}): Promise<void> {
  await prisma.aiLabAuditLog.create({
    data: {
      missionId: entry.missionId,
      nodeKey: entry.nodeKey,
      actorUserId: entry.actorUserId ?? null,
      agentRole: entry.agentRole,
      provider: entry.provider,
      model: entry.model,
      toolId: entry.toolId,
      connectorId: entry.connectorId,
      storeId: entry.storeId,
      action: entry.action,
      decision: entry.decision,
      riskClass: entry.riskClass,
      reason: entry.reason,
      costUsd: entry.costUsd,
      resultStatus: entry.resultStatus,
    },
  });
}

export async function listAuditLogs(params: { missionId?: string; take?: number } = {}) {
  return prisma.aiLabAuditLog.findMany({
    where: params.missionId ? { missionId: params.missionId } : undefined,
    orderBy: { createdAt: "desc" },
    take: params.take ?? 100,
  });
}
