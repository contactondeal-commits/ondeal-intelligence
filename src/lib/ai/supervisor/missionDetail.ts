import { getStorefrontMission } from "@/lib/ai/supervisor/graphStore";
import { listAuditLogs } from "@/lib/ai/policy/audit";
import { listAttachments } from "@/lib/ai/attachments/store";

/**
 * ONDEAL AI CORE — PHASE 5 : détail complet d'une mission, extrait de
 * GET /api/ai-lab/missions/[id] (06/09/2026, §12 "SSE temps réel") pour
 * être réutilisé TEL QUEL par le flux SSE (missions/[id]/stream/route.ts) —
 * une seule implémentation de l'assemblage du payload, jamais deux logiques
 * qui pourraient diverger silencieusement entre le polling classique et le
 * flux temps réel.
 */
export async function buildMissionDetailPayload(id: string) {
  const mission = await getStorefrontMission(id);
  if (!mission) return null;

  const [auditLogs, attachments] = await Promise.all([listAuditLogs({ missionId: id, take: 200 }), listAttachments(id)]);

  return {
    mission: {
      id: mission.id,
      goal: mission.goal,
      status: mission.status,
      environment: mission.environment,
      autonomyLevel: mission.autonomyLevel,
      hardBudgetUsd: mission.hardBudgetUsd,
      storeId: mission.storeId,
      totalCostUsd: mission.totalCostUsd,
      lastError: mission.lastError,
      resultJson: mission.resultJson ? JSON.parse(mission.resultJson) : null,
      createdAt: mission.createdAt,
      startedAt: mission.startedAt,
      finishedAt: mission.finishedAt,
    },
    nodes: mission.nodes.map((n) => ({
      id: n.id,
      key: n.key,
      role: n.role,
      status: n.status,
      dependsOn: n.dependsOnJson ? JSON.parse(n.dependsOnJson) : [],
      input: n.inputJson ? JSON.parse(n.inputJson) : null,
      output: n.outputJson ? JSON.parse(n.outputJson) : null,
      confidence: n.confidence,
      provider: n.provider,
      model: n.model,
      costUsd: n.costUsd,
      startedAt: n.startedAt,
      finishedAt: n.finishedAt,
    })),
    artifacts: mission.artifacts.map((a) => ({ id: a.id, nodeId: a.nodeId, kind: a.kind, storageRef: a.storageRef, meta: a.metaJson ? JSON.parse(a.metaJson) : null, createdAt: a.createdAt })),
    auditLogs,
    attachments: attachments.map((a) => ({ id: a.id, filename: a.filename, kind: a.kind, parseStatus: a.parseStatus, sizeBytes: a.sizeBytes, createdAt: a.createdAt })),
  };
}

export type MissionDetailPayload = NonNullable<Awaited<ReturnType<typeof buildMissionDetailPayload>>>;

/** Statuts terminaux — une mission qui les atteint ne changera plus jamais d'état (voir StorefrontMission.status, graphRunner.ts). */
export const TERMINAL_MISSION_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
