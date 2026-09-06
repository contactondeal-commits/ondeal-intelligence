import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_FEATURES, UNBUILT_FEATURES, FEATURES_ENFORCED_BY_OTHER_MEANS, isFeatureBuilt } from "@/lib/plan-limits";

/**
 * ONDEAL AI CORE — FINAL PHASE : intégrité réelle des entitlements Merchant
 * Plane (06/09/2026).
 *
 * Verrouille la matrice ENTIÈRE PLAN_FEATURES contre le retour du même
 * défaut que celui trouvé et corrigé ce segment : une fonctionnalité
 * annoncée "active" (Settings › Votre plan actuel) à un marchand payant
 * sans AUCUNE route/page réelle derrière. Chaque feature listée dans
 * PLAN_FEATURES doit appartenir à EXACTEMENT une de ces trois catégories,
 * jamais une quatrième silencieuse :
 *
 *   1. BASELINE — incluse dans TOUS les plans (STARTER inclus) : jamais
 *      besoin d'un hasFeature() puisqu'elle n'exclut jamais personne.
 *   2. RÉELLEMENT appliquée — au moins un hasFeature(plan, "x") existe
 *      quelque part dans src/app (vérifié par un vrai scan de fichiers,
 *      jamais une liste recopiée à la main qui pourrait devenir fausse).
 *   3. UNBUILT_FEATURES — honnêtement marquée "bientôt" dans Settings,
 *      jamais présentée comme déjà active.
 *
 * Si un développeur futur ajoute une feature à PLAN_FEATURES sans la
 * câbler ET sans la déclarer dans UNBUILT_FEATURES, CE test échoue —
 * exactement le filet qui aurait empêché le défaut initial.
 */

const SRC_APP_DIR = join(process.cwd(), "src", "app");
const BASELINE_FEATURES: ReadonlySet<string> = new Set(PLAN_FEATURES.STARTER ?? []);

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) listSourceFiles(full, acc);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

function featuresRealyCheckedInSourceApp(): Set<string> {
  const checked = new Set<string>();
  const pattern = /hasFeature\([^,]+,\s*"([a-z_]+)"\)/g;
  for (const file of listSourceFiles(SRC_APP_DIR)) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(pattern)) {
      const feature = match[1];
      if (feature) checked.add(feature);
    }
  }
  return checked;
}

describe("Intégrité de la matrice Merchant Plane (PLAN_FEATURES)", () => {
  const allListedFeatures = new Set(Object.values(PLAN_FEATURES).flat());
  const realCheckedFeatures = featuresRealyCheckedInSourceApp();

  it("chaque feature listée dans PLAN_FEATURES est baseline, réellement câblée (hasFeature réel), appliquée par un autre mécanisme documenté, ou honnêtement marquée UNBUILT_FEATURES — jamais une 5e catégorie silencieuse", () => {
    const orphans: string[] = [];
    for (const feature of allListedFeatures) {
      const isBaseline = BASELINE_FEATURES.has(feature);
      const isReallyChecked = realCheckedFeatures.has(feature);
      const isDeclaredUnbuilt = UNBUILT_FEATURES.has(feature);
      const isEnforcedElsewhere = FEATURES_ENFORCED_BY_OTHER_MEANS.has(feature);
      if (!isBaseline && !isReallyChecked && !isDeclaredUnbuilt && !isEnforcedElsewhere) orphans.push(feature);
    }
    expect(orphans, `Feature(s) sans catégorie réelle connue : ${orphans.join(", ")} — ajoutez un vrai hasFeature(), documentez le mécanisme réel dans FEATURES_ENFORCED_BY_OTHER_MEANS, ou déclarez-la honnêtement dans UNBUILT_FEATURES.`).toEqual([]);
  });

  it("aucune feature déclarée UNBUILT_FEATURES n'est en réalité déjà câblée (sinon la liste elle-même serait devenue mensongère, dans l'autre sens)", () => {
    const staleUnbuilt = [...UNBUILT_FEATURES].filter((f) => realCheckedFeatures.has(f));
    expect(staleUnbuilt, `Feature(s) marquée(s) UNBUILT_FEATURES mais désormais réellement câblée(s) via hasFeature() : ${staleUnbuilt.join(", ")} — retirez-la(les) de UNBUILT_FEATURES, la fonctionnalité existe maintenant.`).toEqual([]);
  });

  it("isFeatureBuilt() reflète fidèlement UNBUILT_FEATURES", () => {
    expect(isFeatureBuilt("marketing")).toBe(true);
    expect(isFeatureBuilt("reports")).toBe(false);
    expect(isFeatureBuilt("team")).toBe(false);
    expect(isFeatureBuilt("agency_workspace")).toBe(false);
  });
});
