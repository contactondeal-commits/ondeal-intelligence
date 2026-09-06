import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — PHASE 5 : Policy Engine + Kill Switch (06/09/2026).
 *
 * Répond directement au mandat "DUAL MAXIMUM MANDATE" (§3/§9/§12/§17/§18) :
 * "AI DOES NOT CONTROL ITS OWN POWER" — ce module est UNIQUEMENT LU par le
 * Supervisor (graphRunner.ts) et par les Tool/Connector Registries ; les
 * seules fonctions d'ÉCRITURE (`setSystemPolicy`) sont appelées EXCLUSIVEMENT
 * par des routes API gardées par `requireCapability("SYSTEM_CODER")` — voir
 * api/ai-lab/policy/route.ts. Aucun code sous supervisor/*.ts n'importe
 * `setSystemPolicy` — vérifiable par grep, jamais une simple convention non
 * appliquée.
 *
 * §12 "POLICY ENGINE" décrit un pipeline en 11 étapes (IDENTITY → TENANT →
 * ROLE → PLAN → CAPABILITY → TOOL → ACTION → RISK → AUTONOMY POLICY →
 * BUDGET → ENVIRONMENT). Cette fondation implémente RÉELLEMENT les étapes
 * pour lesquelles un appelant réel existe aujourd'hui (IDENTITY/CAPABILITY
 * via requireCapability déjà en place ; RISK/AUTONOMY POLICY/BUDGET/
 * ENVIRONMENT ici) — TENANT/ROLE/PLAN au sens marchand ne s'appliquent pas
 * encore à l'AI Lab (Platform Owner uniquement, jamais store-scoped, voir
 * StorefrontMission.storeId qui reste OPTIONNEL). Étendre plus tard = ajouter
 * une étape ici, jamais réinventer le pipeline (même principe que
 * ModelProvider/VerificationHook : extensible sans réécriture).
 */

export type RiskClass =
  | "COGNITION" // lecture/raisonnement pur — jamais d'effet observable hors de la mission elle-même
  | "SANDBOX_EFFECT" // écrit dans le sandbox Coder Agent isolé (jamais le dépôt réel, jamais production) — voir coder/workspace.ts
  | "EXTERNAL_READ" // lit une donnée réelle chez un connecteur tiers
  | "EXTERNAL_WRITE" // écrit/mute une donnée réelle chez un connecteur tiers (ex. créer une branche GitHub, un brouillon de campagne)
  | "PRODUCTION_EFFECT"; // toute action qui toucherait la production OnDeal ou la boutique marchande réelle en écriture

export type PolicyDecision = "ALLOW_AUTO" | "REQUIRE_APPROVAL" | "DENY";

export interface PolicyContext {
  autonomyLevel: "ASSIST" | "AUTONOMOUS" | "DEEP" | "ULTIMATE";
  environment: "SANDBOX" | "PREVIEW" | "PRODUCTION";
  riskClass: RiskClass;
  /** Coût cumulé RÉEL de la mission au moment de la décision — jamais estimé après coup. */
  currentCostUsd: number;
  hardBudgetUsd: number | null;
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

const DEFAULT_SYSTEM_POLICY = {
  killSwitchEngaged: false,
  killSwitchReason: null as string | null,
  defaultAutonomyLevel: "ASSIST",
  maxHardBudgetUsdGlobal: 20,
  productionEffectsAllowed: false,
};

export type SystemPolicySnapshot = typeof DEFAULT_SYSTEM_POLICY & { updatedByUserId: string | null; updatedAt: Date | null };

/** Lit le singleton — le CRÉE avec les valeurs par défaut (les plus restrictives, jamais permissives) s'il n'existe pas encore. */
export async function getSystemPolicy(): Promise<SystemPolicySnapshot> {
  const row = await prisma.systemPolicy.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...DEFAULT_SYSTEM_POLICY },
    update: {},
  });
  return row;
}

/** SEULE fonction d'écriture — appelée UNIQUEMENT depuis une route API Owner (requireCapability déjà vérifié par l'appelant). */
export async function setSystemPolicy(
  patch: Partial<Pick<typeof DEFAULT_SYSTEM_POLICY, "killSwitchEngaged" | "killSwitchReason" | "defaultAutonomyLevel" | "maxHardBudgetUsdGlobal" | "productionEffectsAllowed">>,
  updatedByUserId: string,
): Promise<SystemPolicySnapshot> {
  return prisma.systemPolicy.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...DEFAULT_SYSTEM_POLICY, ...patch, updatedByUserId },
    update: { ...patch, updatedByUserId },
  });
}

/**
 * Décision RÉELLE (§17 "NO FAKE CONTROL") — jamais un ALLOW_AUTO par
 * défaut silencieux pour un risque non explicitement couvert : le `default`
 * du switch est DENY.
 */
export async function evaluatePolicy(ctx: PolicyContext): Promise<PolicyResult> {
  const system = await getSystemPolicy();

  if (system.killSwitchEngaged) {
    return { decision: "DENY", reason: `Kill switch global engagé par le Platform Owner${system.killSwitchReason ? ` (${system.killSwitchReason})` : ""} — toute action est bloquée jusqu'à désengagement explicite.` };
  }

  if (ctx.hardBudgetUsd != null && ctx.currentCostUsd > ctx.hardBudgetUsd) {
    return { decision: "DENY", reason: `Budget dur de la mission dépassé (${ctx.currentCostUsd.toFixed(4)} > ${ctx.hardBudgetUsd} USD) — jamais un dépassement silencieux.` };
  }
  if (ctx.currentCostUsd > system.maxHardBudgetUsdGlobal) {
    return { decision: "DENY", reason: `Plafond ABSOLU du système dépassé (${ctx.currentCostUsd.toFixed(4)} > ${system.maxHardBudgetUsdGlobal} USD, filet de sécurité Owner) — non contournable par un budget de mission plus élevé.` };
  }

  switch (ctx.riskClass) {
    case "COGNITION":
      // §7 "SANDBOX FREEDOM"/§8 "MAXIMUM COGNITION" : jamais gaté par
      // l'autonomie ni l'environnement — la cognition pure est toujours
      // autorisée dans le périmètre déjà vérifié (capability/budget/kill switch ci-dessus).
      return { decision: "ALLOW_AUTO", reason: "Action de cognition pure (lecture/raisonnement) — toujours autorisée dans le périmètre déjà vérifié." };

    case "SANDBOX_EFFECT":
      if (ctx.environment !== "SANDBOX") {
        return { decision: "DENY", reason: `Effet sandbox demandé hors environnement SANDBOX (environnement="${ctx.environment}") — refusé (§8 : les effecteurs restent sous contrôle Owner, jamais autorisés implicitement ailleurs qu'en sandbox).` };
      }
      // §7 : liberté totale en sandbox, quel que soit le niveau d'autonomie
      // (ASSIST inclus) — le sandbox est déjà, par construction, sans effet
      // sur la production ou une boutique réelle (coder/workspace.ts isole
      // un clone jetable).
      return { decision: "ALLOW_AUTO", reason: "Effet SANDBOX (workspace jetable, jamais le dépôt réel ni la production) — autorisé (§7 SANDBOX FREEDOM)." };

    case "EXTERNAL_READ":
      // Lecture chez un connecteur tiers réel : autorisée en AUTONOMOUS+,
      // nécessite une approbation explicite en ASSIST (l'owner garde la main
      // sur la toute première utilisation d'un connecteur, cohérent avec
      // "Owner Sovereignty").
      if (ctx.autonomyLevel === "ASSIST") {
        return { decision: "REQUIRE_APPROVAL", reason: "Lecture externe (connecteur tiers) en niveau ASSIST — approbation Owner requise." };
      }
      return { decision: "ALLOW_AUTO", reason: `Lecture externe autorisée automatiquement (autonomyLevel="${ctx.autonomyLevel}").` };

    case "EXTERNAL_WRITE":
      // §"Owner Sovereignty"/§15 : une écriture chez un tiers (ex. créer une
      // branche GitHub, un brouillon Klaviyo) n'est JAMAIS ALLOW_AUTO dans
      // cette fondation, quel que soit le niveau d'autonomie — même ULTIMATE
      // (§6 : ULTIMATE ne change jamais le PÉRIMÈTRE de pouvoir, seulement
      // la profondeur de raisonnement DANS ce périmètre).
      return { decision: "REQUIRE_APPROVAL", reason: "Écriture externe (connecteur tiers) — approbation Owner explicite requise, quel que soit le niveau d'autonomie (§6/§15)." };

    case "PRODUCTION_EFFECT":
      if (!system.productionEffectsAllowed) {
        return { decision: "DENY", reason: "Effets de production globalement désactivés (SystemPolicy.productionEffectsAllowed=false) — bascule Owner explicite requise avant toute considération au cas par cas." };
      }
      return { decision: "REQUIRE_APPROVAL", reason: "Effet de production — approbation Owner explicite requise même si les effets de production sont globalement activés (§8 : effecteurs toujours Owner-controlled, jamais ALLOW_AUTO)." };

    default:
      return { decision: "DENY", reason: `Classe de risque non reconnue ("${ctx.riskClass}") — refus par défaut, jamais un ALLOW_AUTO implicite pour un risque non couvert explicitement.` };
  }
}
