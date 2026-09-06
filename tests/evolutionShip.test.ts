import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMissionWorkspace } from "@/lib/ai/coder/workspace";

/**
 * ONDEAL AI CORE — §61-65 "System Evolution Console" (06/09/2026).
 *
 * Vérifie evolution/ship.ts sur un VRAI dépôt git jetable (même fixture que
 * tests/coderWorkspace.test.ts — createMissionWorkspace RÉEL, jamais un git
 * simulé) : seules les écritures GitHub (réseau réel) sont mockées, tout le
 * reste (git add/diff/reset, lecture de fichiers) est réel.
 *   - Chaque fichier RÉELLEMENT modifié/créé/supprimé dans le workspace
 *     devient un appel réel putFileOnBranch/deleteFileOnBranch — jamais un
 *     fichier omis, jamais un fichier inventé.
 *   - Le workspace est désindexé (git reset) après lecture — jamais commité
 *     pour de vrai dans ce répertoire disposable.
 *   - Un workspace absent (mission jamais exécutée ici, ou déjà nettoyée) ou
 *     sans aucune modification lève une erreur honnête, jamais une PR
 *     fabriquée.
 */

const createdRoots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

async function buildFixtureWorkspace(missionId: string) {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ondeal-evolution-source-"));
  createdRoots.push(sourceRoot);
  await fs.writeFile(path.join(sourceRoot, "package.json"), "{}");
  await fs.mkdir(path.join(sourceRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, "src", "a.txt"), "contenu original A");
  await fs.writeFile(path.join(sourceRoot, "src", "b.txt"), "contenu original B — sera supprimé");

  const workspace = await createMissionWorkspace(missionId, sourceRoot);
  createdRoots.push(workspace.root);

  // Modifications RÉELLES faites par la "mission" (édition, ajout, suppression) — jamais un diff fabriqué.
  await fs.writeFile(path.join(workspace.root, "src", "a.txt"), "contenu MODIFIÉ A");
  await fs.rm(path.join(workspace.root, "src", "b.txt"));
  await fs.writeFile(path.join(workspace.root, "src", "c.txt"), "nouveau fichier C");

  return workspace;
}

async function loadShip(githubMock: Record<string, ReturnType<typeof vi.fn>>) {
  vi.resetModules();
  vi.doMock("@/lib/ai/connectors/github", () => githubMock);
  return import("@/lib/ai/evolution/ship");
}

function defaultGithubMock() {
  return {
    createBranch: vi.fn().mockResolvedValue({}),
    createPullRequest: vi.fn().mockResolvedValue({ html_url: "https://github.com/contactondeal-commits/ondeal-intelligence/pull/42", number: 42 }),
    getFileShaOnBranch: vi.fn().mockResolvedValue("fakesha123"),
    putFileOnBranch: vi.fn().mockResolvedValue(undefined),
    deleteFileOnBranch: vi.fn().mockResolvedValue(undefined),
  };
}

describe("shipMissionAsPullRequest — livraison RÉELLE des changements d'un workspace de mission", () => {
  it("crée la branche, écrit/supprime EXACTEMENT les fichiers réellement changés, ouvre la PR, et désindexe le workspace ensuite", async () => {
    const workspace = await buildFixtureWorkspace("evo-mission-1");
    const github = defaultGithubMock();
    const { shipMissionAsPullRequest } = await loadShip(github);

    const result = await shipMissionAsPullRequest({
      missionId: "evo-mission-1",
      branchName: "system-evolution/evo-mission-1",
      title: "[System Evolution] test",
      body: "corps du PR",
    });

    expect(github.createBranch).toHaveBeenCalledWith("system-evolution/evo-mission-1", "master");
    expect(result.prUrl).toBe("https://github.com/contactondeal-commits/ondeal-intelligence/pull/42");
    expect(result.prNumber).toBe(42);
    expect(result.branch).toBe("system-evolution/evo-mission-1");

    const byPath = new Map(result.changedFiles.map((c) => [c.path, c.status]));
    expect(byPath.get("src/a.txt")).toBe("M");
    expect(byPath.get("src/b.txt")).toBe("D");
    expect(byPath.get("src/c.txt")).toBe("A");
    expect(byPath.size).toBe(3); // jamais un fichier omis, jamais un fichier fantôme en plus

    // a.txt modifié : contenu RÉEL écrit (celui présent sur disque après édition), sha lu avant écrasement.
    const aCall = github.putFileOnBranch.mock.calls.find((c: unknown[]) => c[0] === "src/a.txt");
    expect(aCall?.[2].toString("utf8")).toBe("contenu MODIFIÉ A");
    expect(aCall?.[4]).toBe("fakesha123");

    // c.txt créé : jamais de sha passé pour une création (getFileShaOnBranch n'a pas de sens ici).
    const cCall = github.putFileOnBranch.mock.calls.find((c: unknown[]) => c[0] === "src/c.txt");
    expect(cCall?.[2].toString("utf8")).toBe("nouveau fichier C");
    expect(cCall?.[4]).toBeFalsy();

    // b.txt supprimé : sha réellement lu puis passé à deleteFileOnBranch.
    expect(github.deleteFileOnBranch).toHaveBeenCalledWith("src/b.txt", "system-evolution/evo-mission-1", expect.stringContaining("b.txt"), "fakesha123");

    expect(github.createPullRequest).toHaveBeenCalledWith({ title: "[System Evolution] test", head: "system-evolution/evo-mission-1", base: "master", body: "corps du PR" });

    // Jamais un commit réel laissé dans le workspace disposable — désindexé après lecture.
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stdout } = await promisify(execFile)("git", ["diff", "--cached", "--name-status"], { cwd: workspace.root });
    expect(stdout.trim()).toBe("");
  });

  it("lève une erreur honnête (jamais une PR fabriquée) quand le workspace de la mission n'existe pas sur cet environnement", async () => {
    const github = defaultGithubMock();
    const { shipMissionAsPullRequest } = await loadShip(github);
    await expect(
      shipMissionAsPullRequest({ missionId: "mission-jamais-executee-ici", branchName: "b", title: "t", body: "corps" }),
    ).rejects.toThrow(/introuvable sur cet environnement/);
    expect(github.createBranch).not.toHaveBeenCalled();
  });

  it("lève une erreur honnête quand la mission n'a modifié AUCUN fichier — jamais une Pull Request vide", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ondeal-evolution-source-"));
    createdRoots.push(sourceRoot);
    await fs.writeFile(path.join(sourceRoot, "package.json"), "{}");
    const workspace = await createMissionWorkspace("evo-mission-empty", sourceRoot);
    createdRoots.push(workspace.root);
    // Aucune modification après la baseline.

    const github = defaultGithubMock();
    const { shipMissionAsPullRequest } = await loadShip(github);
    await expect(
      shipMissionAsPullRequest({ missionId: "evo-mission-empty", branchName: "b", title: "t", body: "corps" }),
    ).rejects.toThrow(/rien à livrer/);
    expect(github.createBranch).not.toHaveBeenCalled();
  });

  it("ne supprime rien sur GitHub si le fichier supprimé n'existait déjà pas sur la branche cible (sha introuvable)", async () => {
    await buildFixtureWorkspace("evo-mission-2");
    const github = defaultGithubMock();
    github.getFileShaOnBranch = vi.fn().mockResolvedValue(null); // le fichier "b.txt" n'existe pas sur la branche → rien à supprimer
    const { shipMissionAsPullRequest } = await loadShip(github);

    await shipMissionAsPullRequest({ missionId: "evo-mission-2", branchName: "b", title: "t", body: "corps" });
    expect(github.deleteFileOnBranch).not.toHaveBeenCalled();
  });
});
