import { NextRequest, NextResponse } from "next/server";
import { CapabilityError, requireCapability } from "@/lib/authz/capabilities";
import { getStorefrontMission } from "@/lib/ai/supervisor/graphStore";
import { listAuditLogs } from "@/lib/ai/policy/audit";
import { listAttachments } from "@/lib/ai/attachments/store";

/** ONDEAL AI CORE — PHASE 5 : détail complet d'une mission (graphe + artefacts + audit + pièces jointes) — Owner uniquement. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireCapability("SYSTEM_CODER");
  } catch (err) {
    if (err instanceof CapabilityError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const mission = await getStorefrontMission(id);
  if (!mission) return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });

  const [auditLogs, attachments] = await Promise.all([listAuditLogs({ missionId: id, take: 200 }), listAttachments(id)]);

  return NextResponse.json({
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
  });
}
