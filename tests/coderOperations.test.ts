import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertPathAllowed, createFile, editFile, readFile } from "@/lib/ai/coder/operations";

/**
 * ONDEAL AI CORE — PHASE 3 : tests des opérations contrôlées (06/09/2026),
 * §8 de la commande ("PAS DE RAW SHELL POUR LE LLM") — vérifie que
 * edit/create respectent strictement le périmètre déclaré de la mission,
 * et que createFile n'écrase jamais un fichier existant.
 */

describe("assertPathAllowed — liste blanche de préfixes", () => {
  it("accepte un chemin sous un préfixe autorisé", () => {
    expect(() => assertPathAllowed("src/app/settings/page.tsx", ["src/app"])).not.toThrow();
  });

  it("refuse un chemin hors des préfixes autorisés", () => {
    expect(() => assertPathAllowed("prisma/schema.prisma", ["src/app", "src/components"])).toThrow(/hors du périmètre/);
  });

  it("refuse un préfixe partiel trompeur (ex. 'src/app-evil' ne doit pas matcher 'src/app')", () => {
    expect(() => assertPathAllowed("src/app-evil/route.ts", ["src/app"])).toThrow(/hors du périmètre/);
  });

  it("accepte un fichier exactement égal au préfixe déclaré", () => {
    expect(() => assertPathAllowed("src/app", ["src/app"])).not.toThrow();
  });
});

const createdRoots: string[] = [];
afterEach(async () => {
  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeFixtureRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ondeal-ops-fixture-"));
  createdRoots.push(root);
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "app", "existing.tsx"), "export default function X() { return null; }");
  return root;
}

describe("editFile — remplacement intégral d'un fichier EXISTANT uniquement", () => {
  it("modifie un fichier existant dans le périmètre autorisé", async () => {
    const root = await makeFixtureRoot();
    await editFile(root, "src/app/existing.tsx", ["src/app"], "export default function X() { return <div>ok</div>; }");
    expect(await readFile(root, "src/app/existing.tsx")).toContain("ok");
  });

  it("refuse d'éditer un fichier hors du périmètre autorisé, même s'il existe", async () => {
    const root = await makeFixtureRoot();
    await expect(editFile(root, "src/app/existing.tsx", ["src/components"], "x")).rejects.toThrow(/hors du périmètre/);
  });

  it("refuse d'éditer un fichier qui n'existe pas (editFile n'est jamais createFile)", async () => {
    const root = await makeFixtureRoot();
    await expect(editFile(root, "src/app/does-not-exist.tsx", ["src/app"], "x")).rejects.toThrow();
  });
});

describe("createFile — n'écrase jamais un fichier existant", () => {
  it("crée un nouveau fichier dans le périmètre autorisé", async () => {
    const root = await makeFixtureRoot();
    await createFile(root, "src/app/new-page.tsx", ["src/app"], "export default function New() { return null; }");
    expect(await readFile(root, "src/app/new-page.tsx")).toContain("New");
  });

  it("refuse d'écraser un fichier déjà existant", async () => {
    const root = await makeFixtureRoot();
    await expect(createFile(root, "src/app/existing.tsx", ["src/app"], "écrasement")).rejects.toThrow();
    expect(await readFile(root, "src/app/existing.tsx")).not.toContain("écrasement");
  });

  it("refuse de créer un fichier hors du périmètre autorisé", async () => {
    const root = await makeFixtureRoot();
    await expect(createFile(root, "prisma/evil.sql", ["src/app"], "DROP TABLE users;")).rejects.toThrow(/hors du périmètre/);
  });
});
