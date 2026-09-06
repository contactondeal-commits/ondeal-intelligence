import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import type { GenerateRequest, GenerateResult, ModelCapabilities, ModelProvider } from "@/lib/ai/providers/provider";
import { createStorefrontMission, getStorefrontMission } from "@/lib/ai/supervisor/graphStore";
import { runStorefrontMission } from "@/lib/ai/supervisor/graphRunner";
import { ingestAttachment, attachToMission } from "@/lib/ai/attachments/store";

/**
 * ONDEAL AI CORE — PHASE 5 : PREUVE RÉELLE de généralisation goal-agnostic
 * (06/09/2026), §182.
 *
 * Contrairement à la mission Phase 4 (scripts/simulate-storefront-mission.ts,
 * câblée en dur sur /login avec 10 rôles fixes et un schéma "finalBrief"),
 * CETTE mission cible /signup — jamais mentionné dans le code du Supervisor
 * — avec un plan à 4 nodes SEULEMENT (brand_strategist + accessibility_reviewer
 * en parallèle → coder_implementation → independent_judge), sans
 * creative_director/synthesis/adversarial_critic, prouvant qu'ils sont
 * RÉELLEMENT optionnels désormais (planInitialGraph généralisé,
 * graphRunner.ts). Exerce aussi : File Intelligence RÉEL (pièce jointe
 * markdown, ingérée puis attachée), le Policy Engine (COGNITION + gate
 * SANDBOX_EFFECT avant coder_implementation), l'Audit Trail, et
 * autonomyLevel=ULTIMATE + hardBudgetUsd réel.
 *
 * Le défaut RÉEL corrigé (voir rapport de session pour le calcul WCAG
 * complet) : src/app/signup/page.tsx utilise des couleurs codées en dur
 * héritées d'un thème clair pré-refonte (#6b6b85 sur --color-surface
 * #131730 = 3.41:1, sous le seuil AA 4.5:1 ; #4f46e5 = 2.80:1, très en
 * dessous du seuil UI 3:1) au lieu des tokens réels déjà définis et
 * conformes (--color-text-muted = 7.59:1, --color-primary-dark = 8.35:1).
 */

class ScriptedAiLabProvider implements ModelProvider {
  readonly name = "anthropic";
  private calls: Array<{ system: string }> = [];

  capabilities(_model: string): ModelCapabilities | null {
    return { maxContextTokens: 200_000, vision: true, toolUse: true, costPerMTokIn: 1, costPerMTokOut: 5 };
  }

  getCallLog() {
    return this.calls;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const text = this.resolve(req);
    this.calls.push({ system: req.system.slice(0, 90) });
    return { text, citations: [], tokensIn: Math.ceil(req.userMessage.length / 4), tokensOut: Math.ceil(text.length / 4) };
  }

  private resolve(req: GenerateRequest): string {
    const sys = req.system;
    if (sys.includes("Tu es le Supervisor d'OnDeal AI")) return PLAN_JSON;
    if (sys.includes('"Brand Strategist"')) return BRAND_JSON;
    if (sys.includes('"Accessibility Reviewer"')) return A11Y_JSON;
    if (sys.includes("Tu es le Juge Indépendant")) return JUDGE_JSON;
    if (req.images && req.images.length > 0) return VISION_JSON;
    if (sys.includes("mode DEBUG")) return DEBUG_JSON;
    if (sys.includes('"planDescription"')) return CODER_PLAN_JSON;
    if (sys.includes("Tu es le Coder Agent")) return CODER_EDIT_JSON;
    throw new Error(`ScriptedAiLabProvider : aucune réponse scriptée pour ce system prompt : "${sys.slice(0, 120)}"`);
  }
}

const PLAN_JSON = JSON.stringify({
  findings: [
    "Décomposition en 4 nodes seulement : 2 analyses indépendantes (marque + accessibilité) en parallèle, puis implémentation Coder Agent réelle, puis Juge indépendant — creative_director/synthesis/adversarial_critic omis car l'objectif ne demande pas plusieurs directions créatives concurrentes, seulement une correction de cohérence.",
  ],
  evidence: ["World State fourni (repo réel : /signup, tokens CSS globals.css) + pièce jointe Owner (politique de contraste)."],
  uncertainties: [],
  recommendations: [],
  confidence: 0.83,
  data: {
    nodes: [
      { key: "brand_audit", role: "brand_strategist", dependsOn: [], objective: "Vérifier si /signup respecte la même identité visuelle (couleurs de marque réelles) que le reste de l'application redessinée." },
      {
        key: "a11y_audit",
        role: "accessibility_reviewer",
        dependsOn: [],
        objective: "Vérifier le contraste réel de TOUT texte à couleur codée en dur sur /signup contre le fond réel de la carte, selon la politique de contraste fournie en pièce jointe.",
      },
      {
        key: "fix_signup",
        role: "coder_implementation",
        dependsOn: ["brand_audit", "a11y_audit"],
        objective: "Remplacer les couleurs codées en dur non conformes de src/app/signup/page.tsx par les tokens CSS réels déjà définis et conformes (jamais une nouvelle couleur inventée) — aucun changement de structure, de copy ou de comportement.",
        previewPath: "/signup",
        pageDescription: "Page /signup d'OnDeal Intelligence — formulaire public de création de compte.",
      },
      { key: "judge", role: "independent_judge", dependsOn: ["fix_signup"], objective: "Décider READY_FOR_RELEASE / FIX_REQUIRED / REJECTED pour cette correction." },
    ],
  },
});

const BRAND_JSON = JSON.stringify({
  findings: [
    "/signup n'utilise AUCUN token de couleur réel (--color-*) — uniquement des couleurs hexadécimales codées en dur (#6b6b85, #4f46e5) qui correspondent à un thème clair pré-refonte, visuellement en rupture avec /login (déjà sur le système de tokens dark actuel, --color-text-muted/--color-primary-dark).",
    "Le lien 'Se connecter'/'CGU'/'politique de confidentialité' utilise #4f46e5 (indigo pré-refonte), alors que --color-primary actuel est #7c6df7 (violet) — incohérence de marque directe, pas seulement un problème de contraste.",
  ],
  evidence: ["src/app/signup/page.tsx (World State repository_files) : 4 occurrences de color:\"#6b6b85\", 3 occurrences de color:\"#4f46e5\", aucune occurrence de var(--color-*)."],
  uncertainties: [],
  recommendations: ["Remplacer #6b6b85 par var(--color-text-muted) et #4f46e5 par var(--color-primary-dark) — ce sont les tokens réels les plus proches en usage déjà validés ailleurs (ex. .auth-marketing-lead, .auth-feature-icon) pour un rôle de texte/lien secondaire équivalent."],
  confidence: 0.88,
  data: {},
});

const A11Y_JSON = JSON.stringify({
  findings: [
    "Contraste RÉEL calculé (WCAG, luminance relative) sur --color-surface (#131730, fond de .auth-card) : #6b6b85 = 3.41:1 (texte normal, seuil AA 4.5:1 — NON CONFORME) ; #4f46e5 = 2.80:1 (lien/UI, seuil AA 3:1 — NON CONFORME, plus grave).",
    "Les tokens de remplacement proposés par l'analyse de marque sont EUX-MÊMES conformes : --color-text-muted (#a4a9c4) = 7.59:1 ; --color-primary-dark (#b3a8ff) = 8.35:1 — la correction de marque et la correction d'accessibilité pointent vers exactement la même action, aucun compromis entre les deux.",
  ],
  evidence: [
    "Politique de contraste fournie en pièce jointe par l'Owner (seuils AA 4.5:1/3:1).",
    "Calcul WCAG effectué sur les valeurs hexadécimales réelles : contrast(#6b6b85,#131730)=3.41, contrast(#4f46e5,#131730)=2.80, contrast(#a4a9c4,#131730)=7.59, contrast(#b3a8ff,#131730)=8.35.",
  ],
  uncertainties: [],
  recommendations: ["Remplacement direct des 2 couleurs codées en dur par les 2 tokens conformes déjà utilisés ailleurs dans l'application — correction de 7 occurrences au total, aucun risque de régression visuelle significative (mêmes familles de teinte, contraste supérieur)."],
  confidence: 0.95,
  data: {},
});

const CODER_PLAN_JSON = JSON.stringify({
  planDescription: "Remplacer, dans src/app/signup/page.tsx, les 4 occurrences de color:\"#6b6b85\" par color:\"var(--color-text-muted)\" et les 3 occurrences de color:\"#4f46e5\" par color:\"var(--color-primary-dark)\" — aucun autre changement.",
  targetFiles: ["src/app/signup/page.tsx"],
});

const CODER_EDIT_JSON = JSON.stringify({
  files: [{ path: "src/app/signup/page.tsx", content: readFileSync("/tmp/ondeal-ai-lab-mission-content/signup-page.tsx", "utf8") }],
});

const DEBUG_JSON = CODER_EDIT_JSON;
const VISION_JSON = JSON.stringify({ overallPass: true, issues: [] });

const JUDGE_JSON = JSON.stringify({
  findings: [
    "Le diff est confiné à src/app/signup/page.tsx, remplace strictement des couleurs codées en dur par des tokens CSS réels déjà utilisés et conformes ailleurs — aucune mutation de donnée, aucune route API touchée.",
    "Typecheck/lint/test/build ont réussi ; la vérification visuelle automatisée a validé le rendu ; les deux analyses en amont (marque + accessibilité) convergent vers exactement la même correction, sans compromis entre elles.",
  ],
  evidence: ["Diff réel (git) de la CoderMission imbriquée.", "Résultat typecheck/lint/test/build réel.", "Rapport de revue visuelle automatisée.", "Analyses brand_strategist + accessibility_reviewer convergentes."],
  uncertainties: ["Aucune revue d'accessibilité complète (clavier, lecteur d'écran) effectuée au-delà du contraste — signalé, jamais omis."],
  recommendations: ["Avant tout déploiement production : revue a11y plus large que le seul contraste."],
  confidence: 0.85,
  data: {
    verdict: "READY_FOR_RELEASE",
    justification: "Correction minimale, réversible, alignée sur deux analyses indépendantes convergentes, toutes vérifications mécaniques et visuelles réussies — prête à être comparée à la production, jamais déployée automatiquement.",
    evidenceReviewed: ["diff git réel", "typecheck/lint/test/build réels", "rapport de vérification visuelle automatisée", "analyse de marque", "analyse d'accessibilité"],
  },
});

async function main() {
  const goal =
    "Audite la page /signup d'OnDeal Intelligence pour toute incohérence visuelle ou d'accessibilité par rapport au système de design actuel (tokens CSS réels), et corrige-la réellement en sandbox si un problème réel est trouvé — jamais la page /login, jamais la production.";

  const mission = await createStorefrontMission({ goal, createdByUserId: "cl_simulation_platform_owner" });
  console.log(`StorefrontMission créée : ${mission.id}`);

  // Owner Sovereignty (§182 : preuve d'usage réel, pas seulement de code mort) —
  // ULTIMATE + budget dur réel, exactement comme un Owner le ferait depuis /ai-lab.
  await prisma.storefrontMission.update({
    where: { id: mission.id },
    data: { autonomyLevel: "ULTIMATE", environment: "SANDBOX", hardBudgetUsd: 5 },
  });

  // File Intelligence RÉEL : ingestion + attachement AVANT l'exécution — le
  // planner (graphRunner.ts::planInitialGraph) reçoit son texte extrait.
  const attachment = await ingestAttachment({
    filename: "design-tokens-accessibility-policy.md",
    mimeType: "text/markdown",
    data: Buffer.from(readFileSync("/tmp/ondeal-ai-lab-mission-content/design-tokens-accessibility-policy.md")),
    uploadedByUserId: "cl_simulation_platform_owner",
  });
  await attachToMission(attachment.id, mission.id);
  console.log(`Pièce jointe ingérée et attachée : ${attachment.id} (parseStatus=${attachment.parseStatus})`);

  const provider = new ScriptedAiLabProvider();
  const outcome = await runStorefrontMission(mission.id, {
    provider,
    sourceRepoRoot: "/tmp/ondeal-dev",
    createdByUserId: "cl_simulation_platform_owner",
    coderSecurity: { allowedPathPrefixes: ["src/app/signup"], maxCostUsd: 5, maxFixIterations: 2, operationTimeoutMs: 180_000 },
    coderPreviewPort: 4611,
    hardBudgetUsd: 5,
  });

  const final = await getStorefrontMission(mission.id);
  const auditLogs = await prisma.aiLabAuditLog.findMany({ where: { missionId: mission.id }, orderBy: { createdAt: "asc" } });
  console.log(
    JSON.stringify(
      {
        outcome,
        callCount: provider.getCallLog().length,
        mission: final
          ? {
              id: final.id,
              status: final.status,
              lastError: final.lastError,
              totalCostUsd: final.totalCostUsd,
              autonomyLevel: final.autonomyLevel,
              environment: final.environment,
              nodes: final.nodes.map((n) => ({ key: n.key, role: n.role, status: n.status, confidence: n.confidence })),
            }
          : null,
        auditLogCount: auditLogs.length,
        auditActions: auditLogs.map((a) => `${a.action}${a.decision ? `(${a.decision})` : ""}`),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
