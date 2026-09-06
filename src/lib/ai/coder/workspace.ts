import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * ONDEAL AI CORE — PHASE 3 : workspace isolé du Coder Agent (06/09/2026).
 *
 * §6 de la commande ("SANDBOX REQUIREMENTS") : chaque mission tourne dans
 * SON PROPRE répertoire temporaire, jamais dans le dépôt de travail réel.
 * Créé par une copie du dépôt SANS `.git`, SANS `node_modules`, et SANS
 * AUCUN fichier `.env*` (donc sans secret réel — DATABASE_URL,
 * ANTHROPIC_API_KEY, etc. ne sont jamais copiés dans un workspace de
 * mission ; vérifié : `npm run build` réussit sans DATABASE_URL, voir
 * commentaire dans operations.ts). Le workspace est ensuite réinitialisé
 * comme un dépôt git propre (`git init` + commit baseline) pour que
 * `getDiff()` (operations.ts) fonctionne sur les modifications RÉELLES de
 * la mission, jamais sur l'historique du dépôt source.
 *
 * `resolveConfined` est le SEUL point d'accès filesystem confiné utilisé
 * par operations.ts — toute opération (readFile/editFile/createFile)
 * DOIT passer par lui. Il rejette explicitement :
 *   - un chemin absolu fourni par l'appelant (jamais interprété tel quel) ;
 *   - un `..` qui ferait sortir de la racine du workspace, même après
 *     résolution symbolique (path traversal — §19 self-review) ;
 * jamais une correction silencieuse du chemin (throw, toujours).
 */

const WORKSPACE_ROOT_PREFIX = path.join(os.tmpdir(), "ondeal-coder-missions");

const EXCLUDED_TOP_LEVEL = new Set([
  ".git",
  ".env",
  ".env.local",
  ".env.production",
  ".next",
  "tsconfig.tsbuildinfo",
]);

/**
 * `node_modules` n'est jamais copié en profondeur (des centaines de Mo,
 * aucun secret n'y transite jamais en pratique — dépendances tierces
 * uniquement) mais LIÉ EN DUR (hardlink, `cp -al`) depuis `sourceRepoRoot` :
 * typecheck/lint/test/build en ont besoin pour fonctionner (Next.js ne peut
 * pas builder sans son propre package).
 *
 * Un symlink a été essayé en premier mais REJETÉ par Turbopack (bundler de
 * Next.js 16) : "Symlink [project]/node_modules is invalid, it points out
 * of the filesystem root" — Turbopack refuse explicitement un
 * `node_modules` racine qui est un lien symbolique pointant hors du
 * répertoire de projet détecté. Un hardlink recensé via `cp -al` apparaît
 * comme un répertoire ordinaire pour Turbopack/Next.js (aucun symlink au
 * niveau du système de fichiers) tout en partageant les mêmes inodes que la
 * source : aucune duplication de contenu (pas de centaines de Mo copiés),
 * seul le coût des entrées de répertoire/métadonnées d'inode. Compromis
 * assumé : les missions partagent ce contenu en LECTURE (aucune mission n'y
 * écrit — seul `.next`, exclu ci-dessus et reconstruit à chaque build, reçoit
 * des écritures) ; une vraie isolation multi-mission CONCURRENTE nécessiterait
 * un node_modules par mission (coûteux) ou un cache pnpm partagé — hors
 * scope de cette fondation (aucune exécution concurrente de missions n'est
 * câblée aujourd'hui, voir missionStore.claimMissionById : une mission à la
 * fois).
 */
const HARDLINKED_TOP_LEVEL = new Set(["node_modules"]);

export interface MissionWorkspace {
  missionId: string;
  root: string;
}

/**
 * Copie `sourceRepoRoot` vers un répertoire temporaire dédié à `missionId`,
 * en excluant tout secret/état lourd (voir EXCLUDED_TOP_LEVEL), puis
 * initialise un dépôt git propre avec un commit "baseline" — jamais une
 * copie du `.git` réel (qui contiendrait potentiellement des remotes/creds
 * configurés localement).
 */
export async function createMissionWorkspace(missionId: string, sourceRepoRoot: string): Promise<MissionWorkspace> {
  if (!/^[a-zA-Z0-9_-]+$/.test(missionId)) {
    throw new Error(`missionId invalide (caractères non alphanumériques) : "${missionId}".`);
  }
  const root = path.join(WORKSPACE_ROOT_PREFIX, missionId);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });

  const entries = await fs.readdir(sourceRepoRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_TOP_LEVEL.has(entry.name)) continue;
    if (entry.name.startsWith(".env")) continue; // garde-fou supplémentaire — toute variante .env* exclue, pas seulement les 3 noms connus
    if (HARDLINKED_TOP_LEVEL.has(entry.name)) {
      // `cp -al` : copie récursive en liens durs (jamais un symlink — voir
      // commentaire de HARDLINKED_TOP_LEVEL ci-dessus, rejeté par Turbopack).
      // Chaque fichier de la copie partage l'inode de la source : aucune
      // duplication de contenu, apparaît comme un répertoire ordinaire.
      await execFileAsync("cp", ["-al", path.resolve(sourceRepoRoot, entry.name), path.join(root, entry.name)]);
      continue;
    }
    await fs.cp(path.join(sourceRepoRoot, entry.name), path.join(root, entry.name), { recursive: true });
  }

  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "system-coder@ondeal.internal"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "OnDeal System Coder"], { cwd: root });
  await execFileAsync("git", ["add", "-A"], { cwd: root });
  await execFileAsync("git", ["commit", "--quiet", "-m", "baseline (workspace de mission, pré-édition)"], { cwd: root });

  return { missionId, root };
}

/**
 * Résout `relPath` DANS la racine du workspace, rejette tout chemin qui en
 * sortirait (traversal via `..`, chemin absolu, lien symbolique menant
 * hors racine). Jamais de correction silencieuse.
 */
export function resolveConfined(root: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new Error(`Chemin absolu refusé (accès confiné au workspace uniquement) : "${relPath}".`);
  }
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, relPath);
  const withSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(withSep)) {
    throw new Error(`Chemin hors du workspace refusé (path traversal) : "${relPath}".`);
  }
  return resolvedTarget;
}

/** Nettoyage — refuse explicitement de supprimer quoi que ce soit hors du préfixe dédié aux workspaces de mission. */
export async function cleanupWorkspace(root: string): Promise<void> {
  const resolved = path.resolve(root);
  const resolvedPrefix = path.resolve(WORKSPACE_ROOT_PREFIX);
  if (resolved !== resolvedPrefix && !resolved.startsWith(resolvedPrefix + path.sep)) {
    throw new Error(`Refus de nettoyer un répertoire hors du préfixe workspace de mission : "${root}".`);
  }
  await fs.rm(resolved, { recursive: true, force: true });
}

/**
 * §19 self-review ("stale workspace") : une mission qui échoue (throw dans
 * verify_and_fix, timeout, crash process) laisse volontairement son
 * workspace en place pour un post-mortem humain — jamais nettoyé par le
 * chemin d'échec lui-même (utile au diagnostic). Cette fonction est le
 * filet de sécurité explicite qui les réclame après coup : à appeler
 * périodiquement (ex. début de chaque nouvelle mission, ou tâche cron
 * dédiée future) — jamais automatique à la milliseconde près, jamais un
 * accès hors du préfixe dédié (même garde que cleanupWorkspace).
 */
export async function reapStaleWorkspaces(maxAgeMs: number): Promise<string[]> {
  const reaped: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(WORKSPACE_ROOT_PREFIX);
  } catch {
    return reaped; // le préfixe n'existe pas encore — rien à réclamer
  }
  const now = Date.now();
  for (const name of entries) {
    const dir = path.join(WORKSPACE_ROOT_PREFIX, name);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat) continue;
    if (now - stat.mtimeMs > maxAgeMs) {
      await cleanupWorkspace(dir);
      reaped.push(dir);
    }
  }
  return reaped;
}
