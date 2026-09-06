import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — §14/§15 "Dynamic Agent Registry / Owner Agent Control"
 * (06/09/2026), clôture réelle. Agrège des stats RÉELLES depuis
 * AiLabAuditLog (action="node_execute") et StorefrontMissionNode — jamais un
 * chiffre inventé. Alimente AI LAB → AGENTS (§90).
 */
export interface AgentRegistryEntry {
  role: string;
  enabled: boolean;
  missionCount: number;
  successCount: number;
  failureCount: number;
  successRate: number | null;
  avgCostUsd: number | null;
  avgLatencyMs: number | null;
  modelsUsed: Array<{ provider: string; model: string; count: number }>;
}

export async function listAgentRegistry(): Promise<AgentRegistryEntry[]> {
  const nodes = await prisma.storefrontMissionNode.findMany({
    select: { role: true, missionId: true, status: true, costUsd: true, provider: true, model: true, startedAt: true, finishedAt: true },
  });
  const configs = await prisma.agentRoleConfig.findMany();
  const configByRole = new Map(configs.map((c) => [c.role, c]));

  const byRole = new Map<string, typeof nodes>();
  for (const n of nodes) {
    const list = byRole.get(n.role) ?? [];
    list.push(n);
    byRole.set(n.role, list);
  }

  const entries: AgentRegistryEntry[] = [];
  for (const [role, rows] of byRole.entries()) {
    const missionIds = new Set(rows.map((r) => r.missionId));
    const succeeded = rows.filter((r) => r.status === "SUCCEEDED");
    const failed = rows.filter((r) => r.status === "FAILED");
    const costRows = succeeded.filter((r) => r.costUsd != null);
    const latencyRows = rows.filter((r) => r.startedAt && r.finishedAt);
    const modelCounts = new Map<string, { provider: string; model: string; count: number }>();
    for (const r of succeeded) {
      if (!r.provider || !r.model) continue;
      const key = `${r.provider}::${r.model}`;
      const entry = modelCounts.get(key) ?? { provider: r.provider, model: r.model, count: 0 };
      entry.count += 1;
      modelCounts.set(key, entry);
    }

    const totalTerminal = succeeded.length + failed.length;
    entries.push({
      role,
      enabled: configByRole.get(role)?.enabled ?? true,
      missionCount: missionIds.size,
      successCount: succeeded.length,
      failureCount: failed.length,
      successRate: totalTerminal > 0 ? succeeded.length / totalTerminal : null,
      avgCostUsd: costRows.length > 0 ? costRows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) / costRows.length : null,
      avgLatencyMs: latencyRows.length > 0 ? latencyRows.reduce((sum, r) => sum + (r.finishedAt!.getTime() - r.startedAt!.getTime()), 0) / latencyRows.length : null,
      modelsUsed: [...modelCounts.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    });
  }

  // Inclut aussi les rôles configurés par l'Owner mais n'ayant encore jamais
  // tourné (0 mission) — jamais absent de la liste simplement parce
  // qu'aucune donnée n'existe encore.
  for (const cfg of configs) {
    if (!byRole.has(cfg.role)) {
      entries.push({ role: cfg.role, enabled: cfg.enabled, missionCount: 0, successCount: 0, failureCount: 0, successRate: null, avgCostUsd: null, avgLatencyMs: null, modelsUsed: [] });
    }
  }

  return entries.sort((a, b) => b.missionCount - a.missionCount);
}

export async function setAgentRoleEnabled(role: string, enabled: boolean, updatedByUserId: string) {
  return prisma.agentRoleConfig.upsert({
    where: { role },
    create: { role, enabled, updatedByUserId },
    update: { enabled, updatedByUserId },
  });
}

/** Rôles explicitement désactivés par l'Owner — lu par graphRunner.ts avant de proposer les rôles disponibles au planner ET avant de dispatcher un node. */
export async function listDisabledRoles(): Promise<Set<string>> {
  const rows = await prisma.agentRoleConfig.findMany({ where: { enabled: false }, select: { role: true } });
  return new Set(rows.map((r) => r.role));
}
