import { z } from "zod";

/**
 * ONDEAL AI CORE — PHASE 2, jeu de tâches fixe pour l'évaluation de modèles
 * (06/09/2026).
 *
 * "grounding_v1" : un jeu de tâches DÉTERMINISTE, indépendant de toute
 * boutique réelle (aucune donnée client n'y transite — voir le commentaire
 * sur ModelEvalRun dans schema.prisma pour pourquoi ce n'est délibérément
 * PAS scopé par storeId). Chaque tâche a une fonction `verify` MÉCANIQUE
 * (format, ancrage à une liste fournie, contrainte de forme) — jamais un
 * jugement de qualité subjectif (ça reste hors scope, voir EvaluationHook /
 * futur Critic dans types.ts). Le but n'est pas de "noter la créativité"
 * d'un modèle mais de vérifier qu'il respecte des CONTRAINTES STRICTES —
 * exactement ce que reason_margin_risk exige déjà d'un modèle en
 * production (voir tasks/marginRisk.ts, verify_margin_risk_grounding).
 */

export const GROUNDING_TASK_SET = "grounding_v1";

export interface ModelEvalTask {
  name: string;
  system: string;
  userMessage: string;
  maxTokens: number;
  /** Jugement MÉCANIQUE de la sortie brute du modèle — jamais un score de qualité subjectif. */
  verify(text: string): { pass: boolean; reason?: string };
}

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

const jsonOnlySchema = z.object({ answer: z.number() });

const KNOWN_INVENTORY = [
  { id: "sku-alpha", name: "Harnais taille M" },
  { id: "sku-beta", name: "Laisse 2m" },
  { id: "sku-gamma", name: "Gamelle inox" },
];

export const GROUNDING_TASKS: ModelEvalTask[] = [
  {
    // Respect strict d'un format JSON imposé, sans texte autour — la même
    // contrainte que reason_margin_risk impose déjà en production.
    name: "json_strict_format",
    system:
      'Réponds STRICTEMENT avec un objet JSON valide, sans aucun texte avant ou après, au format exact : {"answer": <nombre>}. Aucune explication.',
    userMessage: "Combien font 17 plus 26 ? Donne uniquement le résultat au format demandé.",
    maxTokens: 100,
    verify(text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJsonText(text));
      } catch {
        return { pass: false, reason: "Réponse non parsable en JSON." };
      }
      const validated = jsonOnlySchema.safeParse(parsed);
      if (!validated.success) return { pass: false, reason: "Forme JSON invalide (champ answer manquant ou non numérique)." };
      if (validated.data.answer !== 43) return { pass: false, reason: `Réponse incorrecte : ${validated.data.answer} au lieu de 43.` };
      return { pass: true };
    },
  },
  {
    // Ancrage strict à une liste fournie — même principe que le
    // "NO PARTIAL THEATER" de verify_margin_risk_grounding : le modèle ne
    // doit JAMAIS inventer un identifiant absent de la liste donnée.
    name: "no_hallucinated_id",
    system:
      'Tu reçois une liste d\'articles réels avec leur "id". Réponds STRICTEMENT avec un objet JSON valide, sans texte autour, au format exact : {"id": "..."}, en choisissant un "id" EXACTEMENT copié depuis la liste fournie — jamais un identifiant inventé.',
    userMessage: `Liste réelle (JSON) : ${JSON.stringify(KNOWN_INVENTORY)}\n\nChoisis l'article dont le nom contient "Laisse" et réponds avec son id, au format JSON exact demandé.`,
    maxTokens: 100,
    verify(text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJsonText(text));
      } catch {
        return { pass: false, reason: "Réponse non parsable en JSON." };
      }
      const validated = z.object({ id: z.string().min(1) }).safeParse(parsed);
      if (!validated.success) return { pass: false, reason: "Forme JSON invalide (champ id manquant)." };
      const known = new Set(KNOWN_INVENTORY.map((i) => i.id));
      if (!known.has(validated.data.id)) return { pass: false, reason: `id "${validated.data.id}" absent de la liste réelle fournie (hallucination).` };
      if (validated.data.id !== "sku-beta") return { pass: false, reason: `id "${validated.data.id}" ne correspond pas à l'article attendu.` };
      return { pass: true };
    },
  },
  {
    // Respect d'une contrainte de forme numérique exacte (longueur de liste) —
    // teste le suivi d'instruction sans ambiguïté d'interprétation possible.
    name: "exact_count_instruction",
    system:
      'Réponds STRICTEMENT avec un objet JSON valide, sans texte autour, au format exact : {"items": ["...", "...", "..."]}. Le tableau "items" doit contenir EXACTEMENT 3 éléments, ni plus ni moins.',
    userMessage: "Donne-moi exactement 3 couleurs primaires, au format JSON exact demandé.",
    maxTokens: 150,
    verify(text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJsonText(text));
      } catch {
        return { pass: false, reason: "Réponse non parsable en JSON." };
      }
      const validated = z.object({ items: z.array(z.string()) }).safeParse(parsed);
      if (!validated.success) return { pass: false, reason: "Forme JSON invalide (champ items manquant)." };
      if (validated.data.items.length !== 3) return { pass: false, reason: `${validated.data.items.length} élément(s) au lieu de 3 exactement.` };
      return { pass: true };
    },
  },
];
