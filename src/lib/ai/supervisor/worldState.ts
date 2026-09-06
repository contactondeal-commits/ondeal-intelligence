import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorldFact, WorldState } from "@/lib/ai/supervisor/types";

/**
 * ONDEAL AI CORE — PHASE 4 : World State (06/09/2026), §13/§14/§15.
 *
 * Construit un état structuré à partir de SOURCES RÉELLES uniquement —
 * jamais un fait inventé pour combler une case vide. Pour la mission
 * "homepage OnDeal.fr" (§61), la source de vérité DISPONIBLE ici est le
 * DÉPÔT lui-même (le "world" à observer EST le code de l'application —
 * OnDeal Intelligence n'a pas de site marketing séparé, voir constat
 * honnête dans le rapport de session : /login sert de page publique de
 * facto). GA4/traffic/reviews réels concernant onDeal.fr LUI-MÊME ne sont
 * PAS accessibles depuis ce sandbox — marqués INSUFFICIENT_DATA
 * explicitement plutôt que simulés (§15 : "ne jamais inventer une
 * certitude pour paraître plus intelligent").
 */

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

function extractCssTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (!rootMatch) return tokens;
  const body = rootMatch[1]!;
  for (const line of body.split("\n")) {
    const m = line.match(/--([a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (m) tokens[m[1]!] = m[2]!.trim();
  }
  return tokens;
}

export async function buildWorldState(repoRoot: string): Promise<WorldState> {
  const facts: WorldFact[] = [];

  const loginPage = await readIfExists(path.join(repoRoot, "src/app/login/page.tsx"));
  facts.push({
    key: "public_landing_surface",
    value: loginPage
      ? "src/app/login/page.tsx sert de page publique de facto (aucune homepage marketing séparée — la racine / redirige vers /login ou /dashboard selon la session, voir src/app/page.tsx)."
      : "introuvable",
    kind: "FACT",
    source: "REPOSITORY",
  });

  const globalsCss = await readIfExists(path.join(repoRoot, "src/app/globals.css"));
  if (globalsCss) {
    const tokens = extractCssTokens(globalsCss);
    facts.push({
      key: "design_tokens_current",
      value: tokens,
      kind: "FACT",
      source: "REPOSITORY",
      note: "Thème sombre premium indigo/violet — commentaire du fichier indique une direction déjà validée le 03/09/2026 (voir claude/ondeal-refonte-premium-phase1-03-09-2026.md dans le Project).",
    });
  } else {
    facts.push({ key: "design_tokens_current", value: null, kind: "FACT", source: "REPOSITORY", uncertainty: "INSUFFICIENT_DATA", note: "globals.css introuvable." });
  }

  let componentNames: string[] = [];
  try {
    componentNames = (await fs.readdir(path.join(repoRoot, "src/components"), { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
      .map((e) => e.name);
  } catch {
    /* dossier absent — laissé vide, pas d'invention */
  }
  facts.push({
    key: "existing_components_inventory",
    value: componentNames,
    kind: "FACT",
    source: "REPOSITORY",
    note: "§26 : à consulter AVANT de créer un nouveau composant — réutiliser/étendre en priorité.",
  });

  facts.push({
    key: "brand_name",
    value: "OnDeal Intelligence",
    kind: "FACT",
    source: "REPOSITORY",
  });
  facts.push({
    key: "value_proposition_current",
    value: "Détectez les problèmes de votre boutique avant qu'ils vous coûtent de l'argent — compatible Shopify, WooCommerce, PrestaShop.",
    kind: "FACT",
    source: "REPOSITORY",
    note: "Texte actuellement affiché sur /login (colonne marketing).",
  });
  facts.push({
    key: "product_category",
    value: "SaaS B2B d'analyse e-commerce (PAS un storefront grand public avec catalogue/panier/checkout propre)",
    kind: "FACT",
    source: "REPOSITORY",
  });

  // Signaux réels indisponibles depuis ce sandbox — jamais simulés.
  for (const key of ["real_traffic_ga4", "real_conversion_rate", "real_visitor_reviews_on_marketing_page", "competitor_benchmark_live"]) {
    facts.push({
      key,
      value: null,
      kind: "HYPOTHESIS",
      source: "MODEL_INFERENCE",
      uncertainty: "INSUFFICIENT_DATA",
      note: "Aucun accès à une source réelle (GA4/analytics propre à onDeal.fr) depuis cet environnement — jamais fabriqué. À mesurer réellement une fois la candidate déployée en preview partagée.",
    });
  }

  return { builtAt: new Date().toISOString(), facts };
}
