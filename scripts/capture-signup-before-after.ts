import { startPreviewServer, stopPreviewServer } from "@/lib/ai/coder/preview";
import { closeBrowser, openBrowser, screenshot } from "@/lib/ai/coder/browser";
import { promises as fs } from "node:fs";

/** ONDEAL AI CORE — PHASE 5 : capture manuelle avant/après pour /signup (preuve §182), même principe que capture-before-after-screenshots.ts (Phase 4). */
async function capture(root: string, port: number, label: string) {
  const server = await startPreviewServer(root, port);
  try {
    const session = await openBrowser(`${server.origin}/signup`, [server.origin], { width: 1440, height: 900 });
    try {
      const b64 = await screenshot(session);
      const outPath = `/tmp/ondeal-ai-lab-mission-content/${label}-signup-1440.png`;
      await fs.writeFile(outPath, Buffer.from(b64, "base64"));
      console.log(`Écrit : ${outPath}`);
    } finally {
      await closeBrowser(session);
    }
  } finally {
    stopPreviewServer(server);
  }
}

async function main() {
  const root = process.argv[2];
  const port = Number(process.argv[3]);
  const label = process.argv[4];
  if (!root || !port || !label) throw new Error("Usage: tsx capture-signup-before-after.ts <root> <port> <label>");
  await capture(root, port, label);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
