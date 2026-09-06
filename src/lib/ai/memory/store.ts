import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — §57-60 "Persistent Memory foundation" (06/09/2026),
 * clôture réelle (schema → lecture/écriture RÉELLEMENT câblées, jamais
 * seulement une table qui existe sans appelant).
 *
 * HONNÊTETÉ SUR LA PORTÉE (§94/§95, jamais caché) : la recherche de mémoire
 * pertinente ici est MÉCANIQUE (filtre par scope + correspondance de
 * mots-clés sur `content`/`metaJson`), PAS une recherche sémantique par
 * embeddings vectoriels — construire un pipeline d'embeddings (modèle
 * d'embedding, colonne vecteur, index ANN) est un chantier réel séparé,
 * jamais fabriqué ici pour paraître plus sophistiqué qu'il ne l'est. Ce
 * mécanisme mécanique reste réellement utile : "ne jamais répéter une
 * approche déjà connue pour avoir échoué" ne nécessite pas de similarité
 * sémantique fine, un rappel des échecs récents portant sur le même rôle
 * ou les mêmes mots du goal suffit à influencer le planner (voir
 * graphRunner.ts::planInitialGraph, qui injecte le résultat de
 * `recentRelevantMemories` dans le prompt).
 */

export type MemoryScope = "WORKING" | "EPISODIC" | "BRAND" | "DESIGN" | "ENGINEERING" | "FAILURE" | "OUTCOME" | "MODEL_PERFORMANCE";
export type MemorySourceKind = "mission_result" | "owner_note" | "job_result" | "critic_verdict" | "judge_verdict";

export interface WriteMemoryInput {
  scope: MemoryScope;
  content: string;
  sourceKind: MemorySourceKind;
  storeId?: string | null;
  missionId?: string | null;
  meta?: Record<string, unknown>;
  confidence?: number; // 0-1, jamais 1 par défaut sans justification — repli explicite ci-dessous documenté
  expiresAt?: Date | null;
}

export async function writeMemory(input: WriteMemoryInput) {
  return prisma.memoryRecord.create({
    data: {
      scope: input.scope,
      content: input.content,
      sourceKind: input.sourceKind,
      storeId: input.storeId ?? null,
      missionId: input.missionId ?? null,
      metaJson: input.meta ? JSON.stringify(input.meta) : null,
      // Repli documenté (jamais silencieux) : un critic/judge verdict ou un
      // résultat de mission RÉELLEMENT observé (mission_result/job_result)
      // est un FAIT constaté, confidence=1 est donc justifié par défaut ;
      // seul un appelant qui a une raison de douter (ex. inférence
      // partielle) doit explicitement passer une confidence <1.
      confidence: input.confidence ?? 1,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export interface QueryMemoryInput {
  scope?: MemoryScope | MemoryScope[];
  storeId?: string | null;
  keywords?: string[]; // filtre mécanique, voir note d'honnêteté ci-dessus
  limit?: number;
}

/** Ne renvoie jamais un enregistrement expiré (expiresAt dans le passé) — jamais une mémoire périmée réutilisée silencieusement. */
export async function queryMemory(input: QueryMemoryInput) {
  const scopes = input.scope ? (Array.isArray(input.scope) ? input.scope : [input.scope]) : undefined;
  const records = await prisma.memoryRecord.findMany({
    where: {
      ...(scopes ? { scope: { in: scopes } } : {}),
      ...(input.storeId !== undefined ? { storeId: input.storeId } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    take: 200, // fenêtre récente avant filtre mots-clés en mémoire process — jamais un scan illimité de la table
  });
  if (!input.keywords || input.keywords.length === 0) return records.slice(0, input.limit ?? 20);

  const lowerKeywords = input.keywords.map((k) => k.toLowerCase()).filter((k) => k.length >= 3); // mots de 1-2 lettres jamais utilisés comme filtre (trop de faux positifs)
  const matched = records.filter((r) => {
    const haystack = `${r.content} ${r.metaJson ?? ""}`.toLowerCase();
    return lowerKeywords.some((k) => haystack.includes(k));
  });
  return matched.slice(0, input.limit ?? 20);
}

/**
 * §59 "failure-memory" — jamais répéter une approche déjà connue pour avoir
 * échoué. Renvoie un texte prêt à injecter dans un prompt de planning (ou
 * chaîne vide si rien de pertinent) — jamais un objet opaque que l'appelant
 * devrait reformater lui-même à chaque site d'appel.
 */
export async function recentFailureNotes(keywords: string[], limit = 8): Promise<string> {
  const records = await queryMemory({ scope: "FAILURE", keywords, limit });
  if (records.length === 0) return "";
  return records.map((r) => `- [échec connu, ${r.createdAt.toISOString().slice(0, 10)}] ${r.content}`).join("\n");
}

/** §60 "success-memory" — combinaisons agent/modèle/outil/stratégie qui ont RÉELLEMENT fonctionné, jamais une supposition. */
export async function recentSuccessNotes(keywords: string[], limit = 8): Promise<string> {
  const records = await queryMemory({ scope: "OUTCOME", keywords, limit });
  if (records.length === 0) return "";
  return records.map((r) => `- [succès observé, ${r.createdAt.toISOString().slice(0, 10)}] ${r.content}`).join("\n");
}
