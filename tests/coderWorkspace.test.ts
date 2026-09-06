import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWorkspace, createMissionWorkspace, reapStaleWorkspaces, resolveConfined } from "@/lib/ai/coder/workspace";

/**
 * ONDEAL AI CORE — PHASE 3 : tests de confinement du workspace (06/09/2026),
 * §6/§19 de la commande ("path traversal", "sandbox escape", "stale
 * workspace"). Ce sont les garanties de sécurité les plus critiques du
 * Coder Agent — testées ICI, isolément, jamais seulement "en pratique" via
 * une mission complète.
 */

const createdRoots: string[] = [];
afterEach(async () => {
  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

describe("resolveConfined — path traversal", () => {
  const root = "/tmp/ondeal-coder-missions/fake-mission-for-tests";

  it("résout un chemin relatif normal à l'intérieur de la racine", () => {
    expect(resolveConfined(root, "src/app/page.tsx")).toBe(path.join(root, "src/app/page.tsx"));
  });

  it("refuse un chemin absolu", () => {
    expect(() => resolveConfined(root, "/etc/passwd")).toThrow(/absolu/);
  });

  it("refuse un '..' qui sortirait de la racine", () => {
    expect(() => resolveConfined(root, "../../../etc/passwd")).toThrow(/traversal/);
  });

  it("refuse un '..' qui remonte exactement à la racine puis en ressort", () => {
    expect(() => resolveConfined(root, "src/../../outside")).toThrow(/traversal/);
  });

  it("accepte un chemin qui reste dans un sous-répertoire profond", () => {
    expect(resolveConfined(root, "a/b/c/../d")).toBe(path.join(root, "a/b/d"));
  });
});

describe("cleanupWorkspace — refuse de nettoyer hors du préfixe dédié", () => {
  it("refuse un répertoire hors du préfixe workspace de mission", async () => {
    await expect(cleanupWorkspace("/tmp/not-a-mission-workspace")).rejects.toThrow(/préfixe/);
  });

  it("refuse même un chemin qui ressemble au préfixe par simple concaténation de string (ex. un dossier frère)", async () => {
    await expect(cleanupWorkspace("/tmp/ondeal-coder-missions-evil")).rejects.toThrow(/préfixe/);
  });
});

describe("createMissionWorkspace — copie réelle sans secret", () => {
  it("refuse un missionId contenant des caractères non alphanumériques (injection de chemin)", async () => {
    await expect(createMissionWorkspace("../evil", "/tmp")).rejects.toThrow(/invalide/);
  });

  it("exclut .env*, LIE node_modules en dur (hardlink via cp -al, jamais un symlink ni une copie lourde), initialise un dépôt git propre", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ondeal-source-fixture-"));
    createdRoots.push(sourceRoot);
    await fs.writeFile(path.join(sourceRoot, ".env"), "ANTHROPIC_API_KEY=secret-ne-doit-jamais-copier");
    await fs.writeFile(path.join(sourceRoot, "package.json"), "{}");
    await fs.mkdir(path.join(sourceRoot, "node_modules", "x"), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, "node_modules", "x", "index.js"), "// lié en dur, jamais copié en contenu");

    const workspace = await createMissionWorkspace("test-mission-fixture-1", sourceRoot);
    createdRoots.push(workspace.root);

    const envExists = await fs.stat(path.join(workspace.root, ".env")).then(() => true, () => false);
    const nodeModulesLstat = await fs.lstat(path.join(workspace.root, "node_modules"));
    const sourceFileStat = await fs.stat(path.join(sourceRoot, "node_modules", "x", "index.js"));
    const workspaceFileStat = await fs.stat(path.join(workspace.root, "node_modules", "x", "index.js"));
    const nodeModulesContent = await fs.readFile(path.join(workspace.root, "node_modules", "x", "index.js"), "utf8");
    const packageJsonExists = await fs.stat(path.join(workspace.root, "package.json")).then(() => true, () => false);
    const gitExists = await fs.stat(path.join(workspace.root, ".git")).then(() => true, () => false);

    expect(envExists).toBe(false);
    // jamais un symlink (Turbopack le rejette au niveau racine) — un répertoire ordinaire, contenu lié en dur
    expect(nodeModulesLstat.isSymbolicLink()).toBe(false);
    expect(nodeModulesLstat.isDirectory()).toBe(true);
    // même inode que la source = même fichier physique (hardlink réel, pas une copie de contenu)
    expect(workspaceFileStat.ino).toBe(sourceFileStat.ino);
    expect(nodeModulesContent).toBe("// lié en dur, jamais copié en contenu");
    expect(packageJsonExists).toBe(true);
    expect(gitExists).toBe(true);
  });
});

describe("reapStaleWorkspaces — réclame les workspaces abandonnés au-delà de l'âge maximal", () => {
  it("supprime un workspace plus vieux que maxAgeMs, garde un workspace récent", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ondeal-source-fixture-"));
    createdRoots.push(sourceRoot);
    await fs.writeFile(path.join(sourceRoot, "package.json"), "{}");

    const old = await createMissionWorkspace("test-mission-old", sourceRoot);
    const recent = await createMissionWorkspace("test-mission-recent", sourceRoot);
    createdRoots.push(old.root, recent.root);

    const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await fs.utimes(old.root, past, past);

    const reaped = await reapStaleWorkspaces(2 * 60 * 60 * 1000);
    expect(reaped).toContain(old.root);
    expect(reaped).not.toContain(recent.root);

    const oldStillExists = await fs.stat(old.root).then(() => true, () => false);
    const recentStillExists = await fs.stat(recent.root).then(() => true, () => false);
    expect(oldStillExists).toBe(false);
    expect(recentStillExists).toBe(true);
  });
});
