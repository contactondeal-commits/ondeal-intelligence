import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getMissionWorkspaceRoot } from "@/lib/ai/coder/workspace";
import { createBranch, createPullRequest, deleteFileOnBranch, getFileShaOnBranch, putFileOnBranch } from "@/lib/ai/connectors/github";

const execFileAsync = promisify(execFile);

/**
 * ONDEAL AI CORE — §61-65 "System Evolution Console", clôture réelle
 * (06/09/2026).
 *
 * Livre RÉELLEMENT en Pull Request ce qu'une CoderMission a modifié dans son
 * workspace (Phase 3, `src/lib/ai/coder/workspace.ts`) — jamais un `git push`
 * depuis ce process (aucune credential git locale n'existe ici pour le dépôt
 * réel), uniquement l'API Contents de GitHub via le connecteur déjà réel
 * (connectors/github.ts). Le workspace de mission est un dépôt git ISOLÉ créé
 * par `createMissionWorkspace` avec un unique commit "baseline" — `git add -A`
 * puis `git diff --cached --name-status HEAD` (jamais `git diff HEAD` seul,
 * qui omettrait les fichiers NON suivis, donc les fichiers nouvellement créés
 * par la mission) donne la liste RÉELLE et complète des changements, sans
 * jamais committer réellement ce répertoire (reset immédiat après lecture).
 *
 * §"Owner Sovereignty" : cette fonction n'est appelée QUE depuis
 * POST /api/ai-lab/evolution/proposals/[id]/ship, protégée par
 * requireCapabilityWithStepUp — jamais depuis un fichier `supervisor/*.ts`
 * (l'IA ne peut structurellement pas s'auto-livrer un changement de code).
 */

export interface ShippedFileChange {
  path: string;
  status: "A" | "M" | "D";
}

export interface ShipResult {
  branch: string;
  prUrl: string;
  prNumber: number;
  changedFiles: ShippedFileChange[];
}

function parseNameStatus(output: string): ShippedFileChange[] {
  return output
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((line): ShippedFileChange => {
      const tabIndex = line.indexOf("\t");
      const rawStatus = tabIndex >= 0 ? line.slice(0, tabIndex) : line.slice(0, 1);
      const filePath = tabIndex >= 0 ? line.slice(tabIndex + 1) : "";
      const firstChar = rawStatus[0];
      const status: "A" | "M" | "D" = firstChar === "A" || firstChar === "D" ? firstChar : "M";
      return { path: filePath, status };
    })
    .filter((c) => c.path.length > 0);
}

/**
 * Livre en Pull Request les changements RÉELS présents dans le workspace
 * (encore sur disque) d'une CoderMission déjà terminée. Lève une erreur
 * honnête (jamais une PR fabriquée) si le workspace n'existe plus (mission
 * exécutée sur un runner GitHub Actions éphémère, ou nettoyée après 2h par
 * reapStaleWorkspaces) ou si la mission n'a modifié aucun fichier.
 */
export async function shipMissionAsPullRequest(opts: {
  missionId: string;
  branchName: string;
  baseBranch?: string;
  title: string;
  body: string;
}): Promise<ShipResult> {
  const base = opts.baseBranch ?? "master";
  const root = getMissionWorkspaceRoot(opts.missionId);

  try {
    await fs.stat(root);
  } catch {
    throw new Error(
      `Workspace de la mission "${opts.missionId}" introuvable sur cet environnement — probablement exécutée sur un runner GitHub Actions éphémère (workspace disparu avec le runner) ou nettoyée après 2h (reapStaleWorkspaces). Livraison PR impossible depuis ici pour cette mission ; relancez-la si le correctif est toujours nécessaire.`,
    );
  }

  await execFileAsync("git", ["add", "-A"], { cwd: root });
  let nameStatusOutput: string;
  try {
    ({ stdout: nameStatusOutput } = await execFileAsync("git", ["diff", "--cached", "--name-status", "--no-renames", "HEAD"], { cwd: root }));
  } finally {
    // Jamais un commit réel dans ce workspace disposable — on désindexe systématiquement, succès ou échec.
    await execFileAsync("git", ["reset"], { cwd: root }).catch(() => undefined);
  }

  const changes = parseNameStatus(nameStatusOutput);
  if (changes.length === 0) {
    throw new Error("Cette mission n'a modifié aucun fichier — rien à livrer (jamais une Pull Request vide fabriquée).");
  }

  await createBranch(opts.branchName, base);

  for (const change of changes) {
    if (change.status === "D") {
      const sha = await getFileShaOnBranch(change.path, opts.branchName);
      if (sha) await deleteFileOnBranch(change.path, opts.branchName, `Evolution: supprime ${change.path}`, sha);
      continue;
    }
    const absPath = path.join(root, change.path);
    const content = await fs.readFile(absPath);
    const existingSha = change.status === "M" ? await getFileShaOnBranch(change.path, opts.branchName) : null;
    await putFileOnBranch(change.path, opts.branchName, content, `Evolution: ${change.status === "A" ? "ajoute" : "modifie"} ${change.path}`, existingSha);
  }

  const pr = await createPullRequest({ title: opts.title, head: opts.branchName, base, body: opts.body });
  return { branch: opts.branchName, prUrl: pr.html_url as string, prNumber: pr.number as number, changedFiles: changes };
}
