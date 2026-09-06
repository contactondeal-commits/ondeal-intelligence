import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveConfined } from "@/lib/ai/coder/workspace";

/**
 * ONDEAL AI CORE — PHASE 3 : opérations contrôlées du Coder Agent (06/09/2026).
 *
 * §8 de la commande ("PAS DE RAW SHELL POUR LE LLM") : le modèle ne reçoit
 * JAMAIS la possibilité de fournir une commande shell arbitraire. Chaque
 * fonction exportée ici a une signature FIXE (jamais un paramètre "command:
 * string" libre) ; les seules commandes réellement exécutées sont un
 * sous-ensemble FIXE et AUDITÉ des scripts npm déjà déclarés dans
 * package.json (ALLOWED_SCRIPTS ci-dessous) — jamais `db:migrate:deploy`
 * ni `db:push` ni `db:seed`, qui toucheraient un état persistant réel :
 * runBuild() exécute UNIQUEMENT "next build" (== `npm run build`, qui ne
 * fait QUE ça — voir package.json), jamais le buildCommand complet de
 * vercel.json (qui enchaîne db:migrate:deploy AVANT next build, sur la
 * vraie base de production — ce chantier ne doit jamais l'invoquer).
 *
 * Chaque exécution :
 *   - est bornée par un TIMEOUT (SIGKILL au-delà — jamais un process
 *     orphelin) ;
 *   - reçoit un ENVIRONNEMENT MINIMAL explicite (PATH + NODE_ENV=test
 *     uniquement) — jamais `process.env` hérité tel quel (donc jamais
 *     ANTHROPIC_API_KEY/DATABASE_URL/tout secret réel, même si un
 *     workspace en contenait un par erreur — défense en profondeur au-delà
 *     de l'exclusion déjà faite par createMissionWorkspace) ;
 *   - a sa sortie TRONQUÉE à MAX_OUTPUT_BYTES (jamais un flux illimité en
 *     mémoire — protection contre une explosion mémoire/coût de stockage).
 */

const MAX_OUTPUT_BYTES = 512 * 1024; // 512 Ko de log par opération — largement suffisant pour un diagnostic, jamais un flux illimité
const MAX_READ_BYTES = 256 * 1024; // un seul fichier source ne doit jamais dépasser cette taille pour être relu intégralement par le modèle

/** Sous-ensemble AUDITÉ des scripts npm exécutables par le Coder Agent — jamais étendu sans revue explicite. */
const ALLOWED_SCRIPTS = {
  typecheck: "typecheck",
  lint: "lint",
  test: "test",
  build: "build",
} as const;

type AllowedScript = keyof typeof ALLOWED_SCRIPTS;

export interface OperationResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  timedOut: boolean;
}

function runAllowlistedScript(root: string, script: AllowedScript, timeoutMs: number): Promise<OperationResult> {
  const npmScript = ALLOWED_SCRIPTS[script]; // indirection volontaire : même si `script` était mal typé, jamais une valeur passée directement à argv sans passer par cette table fixe
  const start = Date.now();
  return new Promise((resolve) => {
    // `detached: true` fait de ce process le CHEF DE GROUPE de processus
    // (jamais seulement un PID isolé) : `npm run <script>` engendre lui-même
    // un processus enfant réel (next build/tsc/eslint/vitest, potentiellement
    // via un shell intermédiaire) — un simple `child.kill()` ne tuerait QUE
    // `npm`, laissant ce petit-fils tourner en arrière-plan indéfiniment
    // (constaté empiriquement en §19 self-review : des `next-server`
    // orphelins survivaient après la fin d'une mission). `process.kill(-pid)`
    // ci-dessous cible le GROUPE entier, jamais un seul process.
    const child = spawn("npm", ["run", npmScript, "--silent"], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", CI: "true" }, // environnement MINIMAL — jamais process.env hérité tel quel
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;

    function killGroup(): void {
      if (typeof child.pid === "number") {
        try {
          process.kill(-child.pid, "SIGKILL"); // groupe entier — jamais uniquement le PID de `npm`
          return;
        } catch {
          // le groupe n'existe déjà plus, ou kill par groupe non supporté sur cette plateforme — repli ci-dessous
        }
      }
      child.kill("SIGKILL");
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString("utf8");
      else truncated = true;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString("utf8");
      else truncated = true;
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
        stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
        truncated,
        durationMs: Date.now() - start,
        timedOut,
      });
    });
  });
}

export async function runTypecheck(root: string, timeoutMs: number): Promise<OperationResult> {
  return runAllowlistedScript(root, "typecheck", timeoutMs);
}
export async function runLint(root: string, timeoutMs: number): Promise<OperationResult> {
  return runAllowlistedScript(root, "lint", timeoutMs);
}
export async function runTests(root: string, timeoutMs: number): Promise<OperationResult> {
  return runAllowlistedScript(root, "test", timeoutMs);
}
export async function runBuild(root: string, timeoutMs: number): Promise<OperationResult> {
  return runAllowlistedScript(root, "build", timeoutMs);
}

/** Vérifie que `relPath` reste sous un des préfixes autorisés — jamais une édition hors du périmètre déclaré de la mission. */
export function assertPathAllowed(relPath: string, allowedPathPrefixes: string[]): void {
  const normalized = relPath.replace(/\\/g, "/");
  const allowed = allowedPathPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
  if (!allowed) {
    throw new Error(`Chemin "${relPath}" hors du périmètre autorisé pour cette mission (${allowedPathPrefixes.join(", ")}).`);
  }
}

export async function readFile(root: string, relPath: string): Promise<string> {
  const abs = resolveConfined(root, relPath);
  const stat = await fs.stat(abs);
  if (stat.size > MAX_READ_BYTES) throw new Error(`Fichier "${relPath}" trop volumineux (${stat.size} octets) pour une lecture complète.`);
  return fs.readFile(abs, "utf8");
}

/** Remplacement intégral du contenu d'un fichier EXISTANT — jamais un patch partiel ambigu ; le Coder Agent doit toujours produire le contenu complet nouveau. */
export async function editFile(root: string, relPath: string, allowedPathPrefixes: string[], newContent: string): Promise<void> {
  assertPathAllowed(relPath, allowedPathPrefixes);
  const abs = resolveConfined(root, relPath);
  await fs.stat(abs); // lève si le fichier n'existe pas — editFile n'est jamais createFile
  await fs.writeFile(abs, newContent, "utf8");
}

/** Création d'un fichier qui ne doit PAS déjà exister — distinct d'editFile, jamais une écrasement silencieux. */
export async function createFile(root: string, relPath: string, allowedPathPrefixes: string[], content: string): Promise<void> {
  assertPathAllowed(relPath, allowedPathPrefixes);
  const abs = resolveConfined(root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, { encoding: "utf8", flag: "wx" }); // "wx" : échoue si le fichier existe déjà
}

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

/** Recherche confinée à la racine du workspace — jamais un accès filesystem hors racine (voir resolveConfined). */
export async function searchCode(root: string, pattern: string, maxMatches = 50): Promise<SearchMatch[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "grep",
      ["-rn", "--include=*.ts", "--include=*.tsx", "-e", pattern, "."],
      { cwd: root, env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.on("close", () => {
      const matches: SearchMatch[] = [];
      for (const line of out.split("\n")) {
        if (!line) continue;
        const m = line.match(/^(.+?):(\d+):(.*)$/);
        if (m) matches.push({ file: m[1]!.replace(/^\.\//, ""), line: Number(m[2]), text: m[3]! });
        if (matches.length >= maxMatches) break;
      }
      resolve(matches);
    });
    child.on("error", reject);
  });
}

/** Diff RÉEL des modifications de la mission contre le commit "baseline" créé par createMissionWorkspace. */
export async function getDiff(root: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", "--stat=200", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.on("close", () => resolve(out));
    child.on("error", reject);
  }).then(async () => {
    return new Promise<string>((resolve, reject) => {
      const child = spawn("git", ["diff", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
      child.on("close", () => resolve(out.slice(0, MAX_OUTPUT_BYTES)));
      child.on("error", reject);
    });
  });
}
