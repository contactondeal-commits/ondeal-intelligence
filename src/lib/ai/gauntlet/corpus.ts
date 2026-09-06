import type { GauntletTask } from "@/lib/ai/gauntlet/types";

/**
 * ONDEAL GAUNTLET — corpus de départ (06/09/2026).
 *
 * Quatre tâches, toutes RÉELLEMENT accomplies dans OnDeal Intelligence —
 * tirées de cette session et d'un document de session existant du Project
 * (traçabilité en `source`), jamais inventées. Volontairement court : la
 * valeur de ce corpus n'est pas sa taille mais la preuve que le format
 * GauntletTask capture des tâches réelles avec un critère vérifiable — un
 * corpus plus large est un travail FUTURE, pas une fondation.
 */
export const GAUNTLET_CORPUS: GauntletTask[] = [
  {
    id: "set_product_status_mutation",
    category: "coding",
    description:
      "Implémenter executeSetProductStatus(storeId, payload) dans src/app/api/actions/[id]/execute/route.ts : valider productId/targetStatus (ACTIVE|DRAFT|ARCHIVED), appeler updateProductStatus (Shopify), mettre à jour Product.status en base, retourner un ExecutionOutcome typé avec before/applied/verified — jamais une exécution simulée.",
    source: "Session 05-06/09/2026 — chantier « archiver/republier un produit », fichier 3/10 déployé (commit 0d3e25d).",
    expectedCriteria: [
      "tsc --noEmit ne rapporte aucune erreur sur le fichier modifié",
      "vitest run tests/actionKind.test.ts passe (dont le cas set_product_status)",
      "ExecutionOutcome retourné contient before, applied ET verified — jamais une valeur inventée si Shopify échoue",
    ],
  },
  {
    id: "assistant_open_fallback_disclosure",
    category: "architecture",
    description:
      "Ajouter à l'assistant IA (src/lib/intelligence/assistant.ts) un repli ouvert (LLM, recherche web optionnelle) UNIQUEMENT quand aucune intention fermée ne correspond, sans jamais laisser le repli répondre à une question déjà couverte par le moteur de règles déterministe, et sans jamais présenter une réponse générée comme un fait boutique.",
    source: "Session 05-06/09/2026 — même chantier, correctif « v4 », fichiers assistant.ts + AssistantChat.tsx.",
    expectedCriteria: [
      "vitest run tests/assistant.test.ts passe (dont la priorité current_product_summary et le repli honnête sans ANTHROPIC_API_KEY)",
      "le repli ouvert n'est jamais appelé quand matchIntent() trouve une intention",
      "la réponse du repli ouvert est visuellement distinguée (disclosure) d'une réponse déterministe côté UI",
    ],
  },
  {
    id: "fix_stale_sync_frequency_label",
    category: "debugging",
    description:
      "src/app/(app)/settings/page.tsx affichait en dur « Fréquence : Manuelle (planification non implémentée) » alors qu'un cron Vercel (/api/cron/sync, toutes les 6h) existait déjà et fonctionnait — trouvé en confrontant le texte affiché aux logs Vercel réels plutôt qu'à l'UI seule. Corriger le texte pour refléter l'état réel.",
    source: "claude/ondeal-session-05-09-2026-verification-shopify-secret-audit-stabilite-billing-bug.md (Project OnDeal).",
    expectedCriteria: [
      "le texte affiché correspond exactement au schedule réel déclaré dans vercel.json",
      "aucune autre page de l'app n'affirme un état de synchronisation contredit par les logs de production",
    ],
  },
  {
    id: "github_web_editor_precise_insertion",
    category: "tool_use",
    description:
      "Insérer un paragraphe de 10 lignes exactes dans un fichier .tsx existant via l'éditeur web GitHub (aucun accès git push), sans corrompre l'indentation ni introduire de lignes vides superflues — l'éditeur insère parfois 2 sauts de ligne au lieu d'1 pour un seul caractère \\n tapé.",
    source: "Session 05-06/09/2026 — déploiement de AssistantChat.tsx (fichier 8/10), commit b39b872, vérifié 148 lignes exactes.",
    expectedCriteria: [
      "le nombre de lignes du fichier après commit correspond exactement au compte attendu localement (wc -l)",
      "aucune ligne vide superflue ni indentation incorrecte autour de l'insertion (vérifié via get_page_text/screenshot avant commit)",
    ],
  },
];
