import { prisma } from "@/lib/db";
import type { IntegrationProvider } from "@prisma/client";
import { githubHealthCheck } from "@/lib/ai/connectors/github";
import { klaviyoHealthCheck } from "@/lib/ai/connectors/klaviyo";
import { windsorHealthCheck } from "@/lib/ai/connectors/windsor";

/**
 * ONDEAL AI CORE — PHASE 5 : Connector Registry (06/09/2026), §"REALITY RULE".
 *
 * §"NO FAKE CONNECTOR" (absolu) : un connecteur n'affiche JAMAIS CONNECTED
 * sans contexte d'auth réel + un health check réellement exécuté. Ce fichier
 * distingue explicitement DEUX catégories, honnêtement :
 *
 *   1. CONNECTEURS RÉELLEMENT INTÉGRÉS (4) — Shopify, GA4, Judge.me, CJ
 *      Dropshipping — un client API réel existe (src/lib/integrations/*.ts),
 *      les identifiants sont chiffrés en base (table Integration) PAR
 *      BOUTIQUE, et le statut est calculé en interrogeant RÉELLEMENT cette
 *      table (jamais déduit d'une variable d'environnement).
 *
 *   2. CONNECTEURS ARCHITECTURE-ONLY (~28) — demandés par le mandat "AI LAB
 *      ULTIMATE — CONNECTOR HUB", mais SANS client API réel écrit dans ce
 *      dépôt et SANS identifiant configuré nulle part (vérifié — voir
 *      rapport de session). Statut TOUJOURS "NOT_CONFIGURED" — jamais
 *      déduit d'une variable d'environnement qui pourrait exister sans
 *      qu'un vrai appel API ait jamais été câblé derrière (ça reviendrait à
 *      fabriquer un statut CONNECTED non vérifié). `requiredSecrets` documente
 *      ce qu'il FAUDRAIT configurer ET coder pour que ce connecteur devienne
 *      réel — jamais un bouton "Se connecter" qui ne mène à rien.
 */

export type ConnectorStatus = "CONNECTED" | "NOT_CONNECTED" | "NOT_CONFIGURED" | "DEGRADED" | "ERROR" | "READ_ONLY" | "DISABLED";
export type ReadWriteLevel = "READ_ONLY" | "READ_WRITE";
export type ConnectorRiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type CostClass = "FREE" | "FIXED" | "USAGE_BASED";

export interface ConnectorDefinition {
  id: string;
  name: string;
  category: string;
  provider: string;
  authType: "OAUTH2" | "API_KEY" | "SERVICE_ACCOUNT" | "APP_INSTALLATION" | "ACCESS_TOKEN" | "NONE";
  capabilities: string[];
  readWriteLevel: ReadWriteLevel;
  riskLevel: ConnectorRiskLevel;
  ownerOnly: boolean;
  merchantAvailable: boolean;
  costClass: CostClass;
  /** Noms des variables d'environnement/secrets qu'il FAUDRAIT renseigner — jamais leur valeur. */
  requiredSecrets: string[];
  documentationReference: string;
  version: string;
  /** true UNIQUEMENT pour les 4 connecteurs réellement intégrés (integrations/*.ts) — jamais activé pour un connecteur architecture-only. */
  hasRealImplementation: boolean;
  integrationProvider?: IntegrationProvider; // lien vers la table Integration réelle, pour les 4 connecteurs réels uniquement
}

export interface ConnectorHealthResult {
  status: ConnectorStatus;
  detail: string;
  lastSuccessfulCall: string | null;
  lastSync: string | null;
}

// ---------------------------------------------------------------------------
// 4 connecteurs RÉELLEMENT intégrés — storeId requis pour un statut réel.
// ---------------------------------------------------------------------------
const REAL_CONNECTORS: ConnectorDefinition[] = [
  {
    id: "shopify",
    name: "Shopify",
    category: "Ecommerce",
    provider: "shopify",
    authType: "OAUTH2",
    capabilities: ["shopify_data"],
    readWriteLevel: "READ_ONLY",
    riskLevel: "MEDIUM",
    ownerOnly: false,
    merchantAvailable: true,
    costClass: "FREE",
    requiredSecrets: ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET"],
    documentationReference: "src/lib/integrations/shopify.ts, shopify-oauth.ts",
    version: "1.0.0",
    hasRealImplementation: true,
    integrationProvider: "SHOPIFY",
  },
  {
    id: "google_analytics",
    name: "Google Analytics 4",
    category: "Analytics",
    provider: "google",
    authType: "OAUTH2",
    capabilities: ["ga4_data"],
    readWriteLevel: "READ_ONLY",
    riskLevel: "LOW",
    ownerOnly: false,
    merchantAvailable: true,
    costClass: "FREE",
    requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    documentationReference: "src/lib/integrations/google-analytics.ts",
    version: "1.0.0",
    hasRealImplementation: true,
    integrationProvider: "GOOGLE_ANALYTICS",
  },
  {
    id: "judgeme",
    name: "Judge.me",
    category: "Ecommerce",
    provider: "judgeme",
    authType: "API_KEY",
    capabilities: ["judgeme_data"],
    readWriteLevel: "READ_ONLY",
    riskLevel: "LOW",
    ownerOnly: false,
    merchantAvailable: true,
    costClass: "FREE",
    requiredSecrets: [],
    documentationReference: "src/lib/integrations/judgeme.ts",
    version: "1.0.0",
    hasRealImplementation: true,
    integrationProvider: "JUDGEME",
  },
  {
    id: "cj_dropshipping",
    name: "CJ Dropshipping",
    category: "Ecommerce",
    provider: "cjdropshipping",
    authType: "API_KEY",
    capabilities: ["cj_dropshipping_data"],
    readWriteLevel: "READ_ONLY",
    riskLevel: "LOW",
    ownerOnly: false,
    merchantAvailable: true,
    costClass: "FREE",
    requiredSecrets: [],
    documentationReference: "src/lib/integrations/cjdropshipping.ts",
    version: "1.0.0",
    hasRealImplementation: true,
    integrationProvider: "CJDROPSHIPPING",
  },
];

// ---------------------------------------------------------------------------
// ~28 connecteurs ARCHITECTURE-ONLY — demandés par le mandat, aucun client
// API réel écrit, TOUJOURS NOT_CONFIGURED (§"NO FAKE CONNECTOR").
// ---------------------------------------------------------------------------
function archOnly(def: Omit<ConnectorDefinition, "hasRealImplementation" | "version" | "documentationReference">): ConnectorDefinition {
  return { ...def, hasRealImplementation: false, version: "0.0.0-architecture-only", documentationReference: "Non implémenté — voir requiredSecrets et le rapport de session AI Lab Ultimate." };
}

// GitHub (06/09/2026, §45) : PROMU en connecteur RÉEL — un vrai client API
// (connectors/github.ts) existe désormais, adossé à PlatformIntegration
// (PAT chiffré, connecté depuis AI LAB → CONNECTORS → GitHub → Connect,
// jamais une variable d'environnement). hasRealImplementation:true est donc
// honnête ici (contrairement aux ~25 ci-dessous) — son statut est calculé
// par un VRAI appel à api.github.com, jamais déduit de la présence d'un secret.
const GITHUB_CONNECTOR: ConnectorDefinition = {
  id: "github",
  name: "GitHub",
  category: "Development",
  provider: "github",
  authType: "ACCESS_TOKEN",
  capabilities: ["repository_read", "code_search", "pull_request_read", "pull_request_write", "workflow_dispatch"],
  readWriteLevel: "READ_WRITE",
  riskLevel: "HIGH",
  ownerOnly: true,
  merchantAvailable: false,
  costClass: "FREE",
  requiredSecrets: [], // jamais une variable d'environnement — le jeton est saisi par l'Owner via l'UI et chiffré en base (PlatformIntegration), voir connectors/github.ts
  documentationReference: "src/lib/ai/connectors/github.ts",
  version: "1.0.0",
  hasRealImplementation: true,
};

// Klaviyo (06/09/2026, §"Connecteurs restants") : PROMU en connecteur RÉEL —
// un vrai client API (connectors/klaviyo.ts) existe désormais. Contrairement
// à GitHub (PAT Owner-pasté, PlatformIntegration), Klaviyo utilise UNE
// variable d'environnement plateforme (KLAVIYO_API_KEY, déjà documentée par
// requiredSecrets avant même cette promotion) — même principe que
// OPENAI_API_KEY : un seul compte Klaviyo par déploiement OnDeal, jamais un
// identifiant par boutique. hasRealImplementation:true est donc honnête ici
// — son statut est calculé par un VRAI appel à a.klaviyo.com (GET
// /accounts/), jamais déduit de la seule présence de la variable.
const KLAVIYO_CONNECTOR: ConnectorDefinition = {
  id: "klaviyo",
  name: "Klaviyo",
  category: "Marketing",
  provider: "klaviyo",
  authType: "API_KEY",
  capabilities: ["campaigns_read"],
  readWriteLevel: "READ_ONLY",
  riskLevel: "MEDIUM",
  ownerOnly: false,
  merchantAvailable: true,
  costClass: "FREE",
  requiredSecrets: ["KLAVIYO_API_KEY"],
  documentationReference: "src/lib/ai/connectors/klaviyo.ts",
  version: "1.0.0",
  hasRealImplementation: true,
};

// Windsor.ai (06/09/2026, §"Connecteurs restants") : PROMU en connecteur
// RÉEL — un vrai client API (connectors/windsor.ts) existe désormais, même
// principe que Klaviyo ci-dessus (WINDSOR_API_KEY, une variable plateforme,
// jamais un identifiant par boutique). Contrat d'API vérifié par recherche
// réelle avant écriture (voir windsor.ts pour les sources).
const WINDSOR_CONNECTOR: ConnectorDefinition = {
  id: "windsor_ai",
  name: "Windsor.ai",
  category: "Analytics",
  provider: "windsor",
  authType: "API_KEY",
  capabilities: ["cross_channel_analytics"],
  readWriteLevel: "READ_ONLY",
  riskLevel: "LOW",
  ownerOnly: false,
  merchantAvailable: true,
  costClass: "USAGE_BASED",
  requiredSecrets: ["WINDSOR_API_KEY"],
  documentationReference: "src/lib/ai/connectors/windsor.ts",
  version: "1.0.0",
  hasRealImplementation: true,
};

const ARCHITECTURE_ONLY_CONNECTORS: ConnectorDefinition[] = [
  archOnly({ id: "google_calendar", name: "Google Calendar", category: "Productivity", provider: "google", authType: "OAUTH2", capabilities: ["calendar_read"], readWriteLevel: "READ_ONLY", riskLevel: "LOW", ownerOnly: true, merchantAvailable: false, costClass: "FREE", requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] }),
  archOnly({ id: "gmail", name: "Gmail", category: "Productivity", provider: "google", authType: "OAUTH2", capabilities: ["email_read"], readWriteLevel: "READ_ONLY", riskLevel: "MEDIUM", ownerOnly: true, merchantAvailable: false, costClass: "FREE", requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] }),
  archOnly({ id: "google_drive", name: "Google Drive", category: "Productivity", provider: "google", authType: "OAUTH2", capabilities: ["drive_read"], readWriteLevel: "READ_ONLY", riskLevel: "LOW", ownerOnly: true, merchantAvailable: false, costClass: "FREE", requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] }),
  archOnly({ id: "microsoft_365", name: "Microsoft 365", category: "Productivity", provider: "microsoft", authType: "OAUTH2", capabilities: ["mail_read", "calendar_read", "files_read"], readWriteLevel: "READ_ONLY", riskLevel: "MEDIUM", ownerOnly: true, merchantAvailable: false, costClass: "FREE", requiredSecrets: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT_ID"] }),
  archOnly({ id: "notion", name: "Notion", category: "Knowledge", provider: "notion", authType: "OAUTH2", capabilities: ["pages_read", "pages_write"], readWriteLevel: "READ_WRITE", riskLevel: "MEDIUM", ownerOnly: true, merchantAvailable: false, costClass: "FREE", requiredSecrets: ["NOTION_API_KEY"] }),
  archOnly({ id: "superhuman_docs", name: "Superhuman Docs", category: "Documents", provider: "superhuman", authType: "API_KEY", capabilities: ["docs_read", "docs_write"], readWriteLevel: "READ_WRITE", riskLevel: "MEDIUM", ownerOnly: true, merchantAvailable: false, costClass: "FREE", requiredSecrets: ["SUPERHUMAN_API_KEY"] }),
  archOnly({ id: "atlassian", name: "Atlassian (Jira + Confluence)", category: "Development", provider: "atlassian", authType: "OAUTH2", capabilities: ["issues_read", "pages_read"], readWriteLevel: "READ_ONLY", riskLevel: "MEDIUM", ownerOnly: true, merchantAvailable: false, costClass: "FREE", requiredSecrets: ["ATLASSIAN_CLIENT_ID", "ATLASSIAN_CLIENT_SECRET"] }),
  archOnly({ id: "slack", name: "Slack", category: "Communication", provider: "slack", authType: "OAUTH2", capabilities: ["messages_read", "messages_write"], readWriteLevel: "READ_WRITE", riskLevel: "MEDIUM", ownerOnly: true, merchantAvailable: false, costClass: "FREE", requiredSecrets: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"] }),
  archOnly({ id: "context7", name: "Context7", category: "Knowledge", provider: "context7", authType: "API_KEY", capabilities: ["docs_lookup"], readWriteLevel: "READ_ONLY", riskLevel: "LOW", ownerOnly: true, merchantAvailable: false, costClass: "USAGE_BASED", requiredSecrets: ["CONTEXT7_API_KEY"] }),
  archOnly({ id: "adobe", name: "Adobe Creative", category: "Creative", provider: "adobe", authType: "OAUTH2", capabilities: ["asset_generate"], readWriteLevel: "READ_WRITE", riskLevel: "MEDIUM", ownerOnly: false, merchantAvailable: true, costClass: "USAGE_BASED", requiredSecrets: ["ADOBE_CLIENT_ID", "ADOBE_CLIENT_SECRET"] }),
  archOnly({ id: "canva", name: "Canva", category: "Creative", provider: "canva", authType: "OAUTH2", capabilities: ["design_generate"], readWriteLevel: "READ_WRITE", riskLevel: "MEDIUM", ownerOnly: false, merchantAvailable: true, costClass: "USAGE_BASED", requiredSecrets: ["CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET"] }),
  archOnly({ id: "cloudinary", name: "Cloudinary", category: "Creative", provider: "cloudinary", authType: "API_KEY", capabilities: ["asset_transform"], readWriteLevel: "READ_WRITE", riskLevel: "LOW", ownerOnly: false, merchantAvailable: true, costClass: "USAGE_BASED", requiredSecrets: ["CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] }),
  archOnly({ id: "descript", name: "Descript", category: "Media", provider: "descript", authType: "API_KEY", capabilities: ["media_edit"], readWriteLevel: "READ_WRITE", riskLevel: "MEDIUM", ownerOnly: false, merchantAvailable: true, costClass: "USAGE_BASED", requiredSecrets: ["DESCRIPT_API_KEY"] }),
  archOnly({ id: "matrixify", name: "Matrixify", category: "Ecommerce", provider: "matrixify", authType: "API_KEY", capabilities: ["bulk_export", "bulk_import"], readWriteLevel: "READ_WRITE", riskLevel: "HIGH", ownerOnly: false, merchantAvailable: true, costClass: "FIXED", requiredSecrets: ["MATRIXIFY_API_KEY"] }),
  archOnly({ id: "supermetrics", name: "Supermetrics", category: "Analytics", provider: "supermetrics", authType: "OAUTH2", capabilities: ["cross_channel_analytics"], readWriteLevel: "READ_ONLY", riskLevel: "LOW", ownerOnly: false, merchantAvailable: true, costClass: "USAGE_BASED", requiredSecrets: ["SUPERMETRICS_API_KEY"] }),
  archOnly({ id: "zoho_desk", name: "Zoho Desk", category: "Support", provider: "zoho", authType: "OAUTH2", capabilities: ["tickets_read"], readWriteLevel: "READ_ONLY", riskLevel: "MEDIUM", ownerOnly: false, merchantAvailable: true, costClass: "FREE", requiredSecrets: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"] }),
  archOnly({ id: "google_search_console", name: "Google Search Console", category: "SEO", provider: "google", authType: "OAUTH2", capabilities: ["search_performance_read"], readWriteLevel: "READ_ONLY", riskLevel: "LOW", ownerOnly: false, merchantAvailable: true, costClass: "FREE", requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] }),
  archOnly({ id: "google_merchant_center", name: "Google Merchant Center", category: "Ecommerce", provider: "google", authType: "OAUTH2", capabilities: ["product_feed_read"], readWriteLevel: "READ_ONLY", riskLevel: "MEDIUM", ownerOnly: false, merchantAvailable: true, costClass: "FREE", requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] }),
  archOnly({ id: "google_ads", name: "Google Ads", category: "Marketing", provider: "google", authType: "OAUTH2", capabilities: ["campaigns_read"], readWriteLevel: "READ_ONLY", riskLevel: "MEDIUM", ownerOnly: false, merchantAvailable: true, costClass: "FREE", requiredSecrets: ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] }),
  archOnly({ id: "meta_ads", name: "Meta Ads", category: "Marketing", provider: "meta", authType: "OAUTH2", capabilities: ["campaigns_read"], readWriteLevel: "READ_ONLY", riskLevel: "MEDIUM", ownerOnly: false, merchantAvailable: true, costClass: "FREE", requiredSecrets: ["META_APP_ID", "META_APP_SECRET"] }),
  archOnly({ id: "tiktok_ads", name: "TikTok Ads", category: "Marketing", provider: "tiktok", authType: "OAUTH2", capabilities: ["campaigns_read"], readWriteLevel: "READ_ONLY", riskLevel: "MEDIUM", ownerOnly: false, merchantAvailable: true, costClass: "FREE", requiredSecrets: ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"] }),
  archOnly({ id: "figma", name: "Figma", category: "Design", provider: "figma", authType: "OAUTH2", capabilities: ["design_read"], readWriteLevel: "READ_ONLY", riskLevel: "LOW", ownerOnly: false, merchantAvailable: true, costClass: "FREE", requiredSecrets: ["FIGMA_CLIENT_ID", "FIGMA_CLIENT_SECRET"] }),
  archOnly({ id: "merchant_postgres", name: "Base de données externe (Postgres/Supabase)", category: "Database", provider: "postgres", authType: "SERVICE_ACCOUNT", capabilities: ["query_read_only", "schema_inspect"], readWriteLevel: "READ_ONLY", riskLevel: "HIGH", ownerOnly: true, merchantAvailable: false, costClass: "FREE", requiredSecrets: ["MERCHANT_POSTGRES_URL"] }),
  archOnly({ id: "bigquery", name: "BigQuery", category: "Database", provider: "google", authType: "SERVICE_ACCOUNT", capabilities: ["query_read_only"], readWriteLevel: "READ_ONLY", riskLevel: "HIGH", ownerOnly: true, merchantAvailable: false, costClass: "USAGE_BASED", requiredSecrets: ["GOOGLE_BIGQUERY_SERVICE_ACCOUNT_JSON"] }),
  archOnly({ id: "s3", name: "Amazon S3 (stockage objet)", category: "Storage", provider: "aws", authType: "ACCESS_TOKEN", capabilities: ["list_objects", "read_object", "write_artifact"], readWriteLevel: "READ_WRITE", riskLevel: "MEDIUM", ownerOnly: true, merchantAvailable: false, costClass: "USAGE_BASED", requiredSecrets: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET"] }),
  archOnly({ id: "browser_agent", name: "Browser / Agentic Access", category: "Automation", provider: "ondeal_browser_agent", authType: "NONE", capabilities: ["browser_navigate", "browser_screenshot"], readWriteLevel: "READ_ONLY", riskLevel: "LOW", ownerOnly: true, merchantAvailable: false, costClass: "FREE", requiredSecrets: [] }),
];

export const CONNECTOR_REGISTRY: ConnectorDefinition[] = [...REAL_CONNECTORS, GITHUB_CONNECTOR, KLAVIYO_CONNECTOR, WINDSOR_CONNECTOR, ...ARCHITECTURE_ONLY_CONNECTORS];

export function getConnectorDefinition(id: string): ConnectorDefinition | undefined {
  return CONNECTOR_REGISTRY.find((c) => c.id === id);
}

/**
 * §"Browser / Agentic Access" (mandat Connector Hub) : "si Claude in Chrome
 * ne peut pas être embarqué, implémenter l'équivalent via le Browser Agent
 * d'OnDeal — jamais simuler ce connecteur". C'est EXACTEMENT ce qui existe
 * déjà : coder/browser.ts (Playwright réel) est le Browser Agent d'OnDeal —
 * "browser_agent" ci-dessus pointe vers cette implémentation réelle, jamais
 * vers un connecteur tiers non câblé. Non "NOT_CONFIGURED" par défaut :
 * c'est le seul connecteur "architecture-only" qui a en réalité déjà une
 * implémentation ailleurs dans le dépôt (coder/browser.ts) — mais listé
 * séparément du Tool Registry ici parce qu'il n'a pas encore de statut/
 * health check DÉDIÉ à ce niveau connecteur (aujourd'hui exposé seulement
 * comme sous-étape du pipeline coder_implementation, jamais standalone).
 */
export async function getConnectorHealth(id: string, ctx?: { storeId?: string }): Promise<ConnectorHealthResult> {
  const def = getConnectorDefinition(id);
  if (!def) return { status: "NOT_CONFIGURED", detail: `Connecteur "${id}" inconnu du Registry.`, lastSuccessfulCall: null, lastSync: null };

  if (id === "github") {
    const health = await githubHealthCheck();
    return {
      status: health.status,
      detail: health.detail,
      lastSuccessfulCall: health.lastHealthCheckAt,
      lastSync: health.lastHealthCheckAt,
    };
  }

  if (id === "klaviyo") {
    const health = await klaviyoHealthCheck();
    const map: Record<typeof health.status, ConnectorStatus> = { AVAILABLE: "CONNECTED", DISABLED: "NOT_CONFIGURED", ERROR: "ERROR", RATE_LIMITED: "DEGRADED" };
    return { status: map[health.status], detail: health.detail, lastSuccessfulCall: health.status === "AVAILABLE" ? new Date().toISOString() : null, lastSync: null };
  }

  if (id === "windsor_ai") {
    const health = await windsorHealthCheck();
    const map: Record<typeof health.status, ConnectorStatus> = { AVAILABLE: "CONNECTED", DISABLED: "NOT_CONFIGURED", ERROR: "ERROR", RATE_LIMITED: "DEGRADED" };
    return { status: map[health.status], detail: health.detail, lastSuccessfulCall: health.status === "AVAILABLE" ? new Date().toISOString() : null, lastSync: null };
  }

  if (id === "browser_agent") {
    return {
      status: "READ_ONLY",
      detail: "Implémenté via coder/browser.ts (Playwright réel) — actuellement exposé uniquement à l'intérieur du pipeline sandbox_coder_implementation, pas encore comme connecteur standalone indépendant.",
      lastSuccessfulCall: null,
      lastSync: null,
    };
  }

  if (!def.hasRealImplementation || !def.integrationProvider) {
    return { status: "NOT_CONFIGURED", detail: `Aucune implémentation réelle — secrets requis (non configurés) : ${def.requiredSecrets.join(", ") || "(aucun secret, mais aucun client API écrit)"}.`, lastSuccessfulCall: null, lastSync: null };
  }

  if (!ctx?.storeId) {
    return { status: "NOT_CONNECTED", detail: "Connecteur réel, mais aucune boutique ciblée par cette requête — statut par boutique uniquement.", lastSuccessfulCall: null, lastSync: null };
  }

  const integration = await prisma.integration.findUnique({ where: { storeId_provider: { storeId: ctx.storeId, provider: def.integrationProvider } } });
  if (!integration) return { status: "NOT_CONNECTED", detail: "Aucun enregistrement Integration pour cette boutique.", lastSuccessfulCall: null, lastSync: null };
  if (integration.status === "ERROR") return { status: "ERROR", detail: integration.lastError ?? "Erreur non détaillée.", lastSuccessfulCall: null, lastSync: integration.lastSyncedAt?.toISOString() ?? null };
  if (integration.status === "NOT_CONNECTED") return { status: "NOT_CONNECTED", detail: "Jamais connecté.", lastSuccessfulCall: null, lastSync: null };
  return { status: "CONNECTED", detail: "Connecté — dernière synchro réelle enregistrée.", lastSuccessfulCall: integration.lastSyncedAt?.toISOString() ?? null, lastSync: integration.lastSyncedAt?.toISOString() ?? null };
}

export async function listConnectorsWithHealth(ctx?: { storeId?: string }) {
  return Promise.all(CONNECTOR_REGISTRY.map(async (c) => ({ ...c, health: await getConnectorHealth(c.id, ctx) })));
}
