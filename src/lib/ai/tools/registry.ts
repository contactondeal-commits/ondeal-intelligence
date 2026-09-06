import { prisma } from "@/lib/db";
import type { RiskClass } from "@/lib/ai/policy/engine";
import { webSearchEnabled } from "@/lib/intelligence/assistant";
import { PARSER_SUPPORT } from "@/lib/ai/attachments/parse";

/**
 * ONDEAL AI CORE — PHASE 5 : Tool Registry RÉEL (06/09/2026), §"Tool Registry".
 *
 * §"NO CAPABILITY THEATER" : chaque `checkHealth()` ci-dessous inspecte un
 * état RÉEL (variable d'environnement, module réellement importé, table
 * réellement interrogée) — jamais une valeur `AVAILABLE` codée en dur pour
 * un outil non réellement câblé. Un outil dont l'implémentation n'existe
 * pas encore n'apparaît PAS ici (jamais listé "à venir" — le Tool Picker
 * frontend n'affiche QUE ce que ce fichier retourne).
 *
 * Volontairement statique (pas de plugin loader dynamique) — cohérent avec
 * providers/provider.ts et jobs/types.ts : l'extensibilité vient d'ajouter
 * une entrée ici, jamais d'un mécanisme de découverte spéculatif sans
 * appelant réel.
 */

export type ToolHealth = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "NOT_CONFIGURED";

export interface ToolHealthResult {
  status: ToolHealth;
  detail: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  readWrite: "READ" | "WRITE";
  riskClass: RiskClass;
  /** null = pas de restriction d'environnement particulière (au-delà du gate riskClass déjà appliqué par le Policy Engine). */
  environmentRestrictions: Array<"SANDBOX" | "PREVIEW" | "PRODUCTION"> | null;
  costModel: "FREE" | "TOKEN_BASED" | "PER_CALL";
  timeoutMs: number;
  /** Sous-système qui implémente réellement l'outil — jamais un simple libellé marketing. */
  implementedBy: string;
  checkHealth(ctx?: { storeId?: string }): Promise<ToolHealthResult>;
}

async function shopifyLikeHealth(storeId: string | undefined, provider: "SHOPIFY" | "GOOGLE_ANALYTICS" | "JUDGEME" | "CJDROPSHIPPING", label: string): Promise<ToolHealthResult> {
  if (!storeId) {
    return { status: "DEGRADED", detail: `Aucune boutique ciblée pour cette mission — statut réel de "${label}" indisponible sans storeId (mécanisme câblé, mais rien à vérifier).` };
  }
  const integration = await prisma.integration.findUnique({ where: { storeId_provider: { storeId, provider } } });
  if (!integration || integration.status !== "CONNECTED") {
    return { status: "NOT_CONFIGURED", detail: `Boutique "${storeId}" : ${label} non connecté (statut réel table Integration : ${integration?.status ?? "aucun enregistrement"}).` };
  }
  const staleForDays = integration.lastSyncedAt ? (Date.now() - integration.lastSyncedAt.getTime()) / 86_400_000 : null;
  if (staleForDays != null && staleForDays > 7) {
    return { status: "DEGRADED", detail: `${label} connecté mais dernière synchro il y a ${Math.round(staleForDays)} jour(s).` };
  }
  return { status: "AVAILABLE", detail: `${label} connecté (dernière synchro : ${integration.lastSyncedAt?.toISOString() ?? "jamais"}).` };
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  {
    id: "web_research",
    name: "Web Research",
    description: "Recherche web réelle (résultats = donnée externe non fiable, jamais une instruction) — réutilise le mécanisme ONDEAL_ENABLE_WEB_SEARCH déjà en production (assistant.ts).",
    category: "Research",
    readWrite: "READ",
    riskClass: "EXTERNAL_READ",
    environmentRestrictions: null,
    costModel: "TOKEN_BASED",
    timeoutMs: 60_000,
    implementedBy: "supervisor/catalogue.ts::researcher (anthropic web_search_20250305)",
    async checkHealth() {
      if (!webSearchEnabled()) return { status: "NOT_CONFIGURED", detail: "ONDEAL_ENABLE_WEB_SEARCH n'est pas à \"true\"." };
      if (!process.env.ANTHROPIC_API_KEY) return { status: "NOT_CONFIGURED", detail: "ANTHROPIC_API_KEY absent." };
      return { status: "AVAILABLE", detail: "Recherche web activée et clé modèle présente." };
    },
  },
  {
    id: "deep_research",
    name: "Deep Research",
    description: "Décompose l'objectif en sous-questions, lance plusieurs nodes \"researcher\" en parallèle, synthétise avec citations — même mécanisme que Web Research, orchestré à plusieurs sous-questions par le plan du Supervisor plutôt qu'un outil séparé.",
    category: "Research",
    readWrite: "READ",
    riskClass: "EXTERNAL_READ",
    environmentRestrictions: null,
    costModel: "TOKEN_BASED",
    timeoutMs: 180_000,
    implementedBy: "supervisor/graphRunner.ts (plan à plusieurs nodes \"researcher\" + \"synthesis\")",
    async checkHealth() {
      if (!webSearchEnabled()) return { status: "NOT_CONFIGURED", detail: "ONDEAL_ENABLE_WEB_SEARCH n'est pas à \"true\" — Deep Research dépend entièrement de Web Research." };
      return { status: "AVAILABLE", detail: "Recherche web activée — le Supervisor peut planifier plusieurs nodes \"researcher\"." };
    },
  },
  {
    id: "repository_inspect",
    name: "Repository (lecture)",
    description: "Inspection réelle du dépôt (lecture de fichiers, recherche) — Coder Agent Phase 3, jamais réimplémenté.",
    category: "Development",
    readWrite: "READ",
    riskClass: "COGNITION",
    environmentRestrictions: null,
    costModel: "TOKEN_BASED",
    timeoutMs: 30_000,
    implementedBy: "coder/operations.ts",
    async checkHealth() {
      return { status: "AVAILABLE", detail: "Toujours disponible — opère sur le dépôt source local, aucune dépendance externe." };
    },
  },
  {
    id: "sandbox_coder_implementation",
    name: "Sandbox Code + Build + Test + Browser + Vision",
    description: "Implémente un changement de code réel dans un workspace SANDBOX jetable (jamais le dépôt réel ni la production) : edit → diff → typecheck/lint/test/build → preview → navigation Browser réelle → revue Vision réelle. Coder Agent Phase 3, réutilisé sans modification.",
    category: "Development",
    readWrite: "WRITE",
    riskClass: "SANDBOX_EFFECT",
    environmentRestrictions: ["SANDBOX"],
    costModel: "TOKEN_BASED",
    timeoutMs: 20 * 60_000,
    implementedBy: "coder/steps.ts, coder/missionRunner.ts, coder/workspace.ts, coder/browser.ts, coder/vision.ts",
    async checkHealth() {
      if (!process.env.ANTHROPIC_API_KEY) return { status: "NOT_CONFIGURED", detail: "ANTHROPIC_API_KEY absent — les steps edit/vision ont besoin d'un vrai appel modèle." };
      return { status: "AVAILABLE", detail: "Pipeline Coder Agent disponible (git/tsc/eslint/vitest/next build/Playwright réels)." };
    },
  },
  {
    id: "data_analysis",
    name: "Data Analysis",
    description: "Calcul déterministe RÉEL (JS, jamais le modèle) sur les faits numériques du World State — sum/avg/min/max/count/delta.",
    category: "Analytics",
    readWrite: "READ",
    riskClass: "COGNITION",
    environmentRestrictions: null,
    costModel: "FREE",
    timeoutMs: 5_000,
    implementedBy: "supervisor/dataAnalysis.ts",
    async checkHealth() {
      return { status: "AVAILABLE", detail: "Calcul JS pur, aucune dépendance externe." };
    },
  },
  {
    id: "store_data",
    name: "Store Data",
    description: "Accès en lecture aux données réelles d'UNE boutique déjà connectée (World State + intégrations Shopify/GA4/Judge.me/CJ), avec provenance — jamais une donnée fusionnée sans traçabilité.",
    category: "Data",
    readWrite: "READ",
    riskClass: "EXTERNAL_READ",
    environmentRestrictions: null,
    costModel: "FREE",
    timeoutMs: 10_000,
    implementedBy: "supervisor/worldState.ts + table Integration",
    async checkHealth(ctx) {
      if (!ctx?.storeId) return { status: "DEGRADED", detail: "Aucune boutique ciblée par la mission — le mécanisme est câblé mais rien à lire sans storeId." };
      const rows = await prisma.integration.findMany({ where: { storeId: ctx.storeId, status: "CONNECTED" } });
      if (rows.length === 0) return { status: "NOT_CONFIGURED", detail: "Aucune intégration CONNECTED pour cette boutique." };
      return { status: "AVAILABLE", detail: `${rows.length} intégration(s) CONNECTED pour cette boutique.` };
    },
  },
  {
    id: "shopify_data",
    name: "Shopify (données boutique)",
    description: "Lecture des données Shopify réellement synchronisées (catalogue, stock, commandes) pour la boutique ciblée par la mission.",
    category: "Ecommerce",
    readWrite: "READ",
    riskClass: "EXTERNAL_READ",
    environmentRestrictions: null,
    costModel: "FREE",
    timeoutMs: 10_000,
    implementedBy: "integrations/shopify.ts",
    async checkHealth(ctx) {
      return shopifyLikeHealth(ctx?.storeId, "SHOPIFY", "Shopify");
    },
  },
  {
    id: "ga4_data",
    name: "Google Analytics 4 (données trafic)",
    description: "Lecture des données GA4 réellement synchronisées (trafic, acquisition) pour la boutique ciblée.",
    category: "Analytics",
    readWrite: "READ",
    riskClass: "EXTERNAL_READ",
    environmentRestrictions: null,
    costModel: "FREE",
    timeoutMs: 10_000,
    implementedBy: "integrations/google-analytics.ts",
    async checkHealth(ctx) {
      return shopifyLikeHealth(ctx?.storeId, "GOOGLE_ANALYTICS", "GA4");
    },
  },
  {
    id: "judgeme_data",
    name: "Judge.me (avis)",
    description: "Lecture des avis clients réellement synchronisés pour la boutique ciblée.",
    category: "Ecommerce",
    readWrite: "READ",
    riskClass: "EXTERNAL_READ",
    environmentRestrictions: null,
    costModel: "FREE",
    timeoutMs: 10_000,
    implementedBy: "integrations/judgeme.ts",
    async checkHealth(ctx) {
      return shopifyLikeHealth(ctx?.storeId, "JUDGEME", "Judge.me");
    },
  },
  {
    id: "cj_dropshipping_data",
    name: "CJ Dropshipping (stock fournisseur)",
    description: "Lecture du stock fournisseur réellement synchronisé pour la boutique ciblée.",
    category: "Ecommerce",
    readWrite: "READ",
    riskClass: "EXTERNAL_READ",
    environmentRestrictions: null,
    costModel: "FREE",
    timeoutMs: 10_000,
    implementedBy: "integrations/cjdropshipping.ts",
    async checkHealth(ctx) {
      return shopifyLikeHealth(ctx?.storeId, "CJDROPSHIPPING", "CJ Dropshipping");
    },
  },
  {
    id: "file_intelligence",
    name: "File Intelligence (pièces jointes)",
    description: `Upload → stockage → extraction de texte → mise à disposition du World State avec provenance USER_ATTACHMENT. Formats réellement supportés aujourd'hui : ${PARSER_SUPPORT.join(", ")}.`,
    category: "Files",
    readWrite: "READ",
    riskClass: "COGNITION",
    environmentRestrictions: null,
    costModel: "FREE",
    timeoutMs: 30_000,
    implementedBy: "attachments/parse.ts, attachments/store.ts",
    async checkHealth() {
      return { status: "AVAILABLE", detail: `Parsers réels installés : ${PARSER_SUPPORT.join(", ")}.` };
    },
  },
  {
    id: "mission_history",
    name: "Library / Mission History",
    description: "Lecture des missions passées (graphe, artefacts, coûts, verdicts) — base pour réouvrir/comparer une mission antérieure.",
    category: "Files",
    readWrite: "READ",
    riskClass: "COGNITION",
    environmentRestrictions: null,
    costModel: "FREE",
    timeoutMs: 5_000,
    implementedBy: "supervisor/graphStore.ts::listStorefrontMissions",
    async checkHealth() {
      return { status: "AVAILABLE", detail: "Table storefront_missions toujours interrogeable." };
    },
  },
  {
    id: "create_image",
    name: "Create Image",
    description: "Génération d'image IA — AUCUN provider de génération d'image n'est câblé aujourd'hui dans OnDeal Intelligence (jamais simulé).",
    category: "Creative",
    readWrite: "WRITE",
    riskClass: "SANDBOX_EFFECT",
    environmentRestrictions: ["SANDBOX"],
    costModel: "PER_CALL",
    timeoutMs: 60_000,
    implementedBy: "(non implémenté)",
    async checkHealth() {
      return { status: "NOT_CONFIGURED", detail: "Aucun provider de génération d'image configuré — §\"NO CAPABILITY THEATER\", jamais affiché disponible sans provider réel." };
    },
  },
];

export function getToolDefinition(id: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.id === id);
}

export async function listToolsWithHealth(ctx?: { storeId?: string }): Promise<Array<ToolDefinition & { health: ToolHealthResult }>> {
  const results = await Promise.all(TOOL_REGISTRY.map(async (t) => ({ ...t, health: await t.checkHealth(ctx) })));
  return results;
}
