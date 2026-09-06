import type { Browser, ConsoleMessage, Page, Request as PWRequest } from "playwright";

/**
 * ONDEAL AI CORE — PHASE 3 : Browser Agent réel (06/09/2026), §9 de la
 * commande.
 *
 * Playwright réel (pas d'abstraction sans navigateur derrière — exigence
 * explicite §9). `import type` uniquement en tête : `playwright` est un
 * devDependency (voir package.json) utilisé par le Coder Agent/CI, jamais
 * expédié dans le bundle serveur Vercel de l'app elle-même (aucune route
 * Next.js n'importe ce fichier — voir le rapport de session, "DEV PROOF vs
 * PRODUCT RUNTIME").
 *
 * SSRF (§19 self-review) : `open()` refuse toute URL dont l'origine n'est
 * pas dans `allowedOrigins` — jamais une navigation vers une URL arbitraire
 * fournie indirectement par une sortie de modèle. Une mission ne doit
 * naviguer que vers SON PROPRE serveur de preview local (voir preview.ts),
 * jamais vers une origine externe.
 */
export interface BrowserSession {
  browser: Browser;
  page: Page;
  consoleMessages: Array<{ type: string; text: string }>;
  failedRequests: Array<{ url: string; failure: string | null }>;
}

function assertOriginAllowed(url: string, allowedOrigins: string[]): void {
  const origin = new URL(url).origin;
  if (!allowedOrigins.includes(origin)) {
    throw new Error(`Navigation refusée vers une origine non autorisée : "${origin}" (autorisées : ${allowedOrigins.join(", ")}).`);
  }
}

export async function openBrowser(url: string, allowedOrigins: string[]): Promise<BrowserSession> {
  assertOriginAllowed(url, allowedOrigins);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleMessages: Array<{ type: string; text: string }> = [];
  page.on("console", (msg: ConsoleMessage) => consoleMessages.push({ type: msg.type(), text: msg.text() }));

  const failedRequests: Array<{ url: string; failure: string | null }> = [];
  page.on("requestfailed", (req: PWRequest) => failedRequests.push({ url: req.url(), failure: req.failure()?.errorText ?? null }));

  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  return { browser, page, consoleMessages, failedRequests };
}

export async function navigate(session: BrowserSession, url: string, allowedOrigins: string[]): Promise<void> {
  assertOriginAllowed(url, allowedOrigins);
  await session.page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
}

export async function click(session: BrowserSession, selector: string): Promise<void> {
  await session.page.click(selector, { timeout: 10_000 });
}

export async function type(session: BrowserSession, selector: string, text: string): Promise<void> {
  await session.page.fill(selector, text, { timeout: 10_000 });
}

export async function scroll(session: BrowserSession, deltaY: number): Promise<void> {
  await session.page.mouse.wheel(0, deltaY);
}

export async function getVisibleText(session: BrowserSession): Promise<string> {
  return session.page.evaluate(() => document.body.innerText);
}

export async function getDom(session: BrowserSession): Promise<string> {
  return session.page.content();
}

export function getConsoleMessages(session: BrowserSession): Array<{ type: string; text: string }> {
  return session.consoleMessages;
}

export function getFailedRequests(session: BrowserSession): Array<{ url: string; failure: string | null }> {
  return session.failedRequests;
}

/** Capture réelle — retourne le PNG en base64 (jamais une image de substitution). */
export async function screenshot(session: BrowserSession): Promise<string> {
  const buf = await session.page.screenshot({ type: "png", fullPage: true });
  return buf.toString("base64");
}

export async function closeBrowser(session: BrowserSession): Promise<void> {
  await session.browser.close();
}
