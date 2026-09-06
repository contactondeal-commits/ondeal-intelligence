import { startPreviewServer, stopPreviewServer } from "@/lib/ai/coder/preview";
import { closeBrowser, openBrowser, screenshot } from "@/lib/ai/coder/browser";
import { promises as fs } from "node:fs";

/**
 * ONDEAL AI CORE — PHASE 4 : captures manuelles multi-viewport (06/09/2026), §30.
 *
 * Le pipeline automatique (steps.ts, PHASE 3, RÉUTILISÉ SANS MODIFICATION)
 * ne capture qu'UN SEUL viewport par défaut — extension additive non
 * encore câblée dans la boucle automatique (limitation honnêtement
 * documentée dans le rapport de session). Ce script capture RÉELLEMENT,
 * en plus, desktop (1440px) + mobile (390px) sur DEUX serveurs de preview
 * réels : le dépôt source INCHANGÉ (/tmp/ondeal-dev, déjà buildé — "AVANT")
 * et le workspace de mission déjà buildé par la CoderMission réelle
 * ("APRÈS") — jamais une image de substitution.
 */
async function capture(root: string, port: number, label: string) {
  const server = await startPreviewServer(root, port);
  try {
    for (const [vpLabel, viewport] of [
      ["desktop-1440", { width: 1440, height: 900 }],
      ["mobile-390", { width: 390, height: 844 }],
    ] as const) {
      const session = await openBrowser(`${server.origin}/login`, [server.origin], viewport);
      try {
        const b64 = await screenshot(session);
        const outPath = `/tmp/ondeal-mission-content/${label}-${vpLabel}.png`;
        await fs.writeFile(outPath, Buffer.from(b64, "base64"));
        console.log(`Écrit : ${outPath}`);
      } finally {
        await closeBrowser(session);
      }
    }
  } finally {
    stopPreviewServer(server);
  }
}

async function main() {
  const root = process.argv[2];
  const port = Number(process.argv[3]);
  const label = process.argv[4];
  if (!root || !port || !label) throw new Error("Usage: tsx capture-before-after-screenshots.ts <root> <port> <label>");
  await capture(root, port, label);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
