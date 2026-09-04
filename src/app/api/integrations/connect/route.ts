import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireStoreAccess, requireRole, ADMIN_ROLES, AuthError } from "@/lib/auth";
import { encryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { verifyShopifyCredentials, type ShopifyCredentials } from "@/lib/integrations/shopify";
import { verifyJudgemeCredentials, type JudgemeCredentials } from "@/lib/integrations/judgeme";
import { syncShopify, syncJudgeme } from "@/lib/sync/pipeline";

// PHASE 17/18 — Connexion d'une intégration. Les credentials sont
// VÉRIFIÉS en direct auprès du fournisseur avant d'être chiffrés et
// stockés. Aucun credential n'est jamais inventé ou pré-rempli : l'échec de
// vérification bloque la connexion avec un message clair.
// SÉCURITÉ (04/09/2026) — le domaine Shopify est strictement contraint à
// `*.myshopify.com` : l'app n'effectue jamais de requête sortante vers un
// hôte arbitraire fourni par un utilisateur (anti-SSRF).
const MYSHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/i;
const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    provider: z.enum(["SHOPIFY", "JUDGEME"]),
    credentials: z
      .object({
        domain: z.string().trim().max(253).optional(),
        accessToken: z.string().trim().max(512).optional(),
        shopDomain: z.string().trim().max(253).optional(),
        apiToken: z.string().trim().max(512).optional(),
      })
      .strict(),
  })
  .strict();

function normalizeMyshopifyDomain(raw: string | undefined): string | null {
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  return MYSHOPIFY_DOMAIN.test(host) ? host : null;
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Champs manquants ou invalides." }, { status: 400 });
  const { storeId, provider, credentials } = parsed.data;

  let userId: string;
  try {
    const access = await requireStoreAccess(storeId);
    userId = access.userId;
    requireRole(access.role, ADMIN_ROLES);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  try {
    if (provider === "SHOPIFY") {
      const domain = normalizeMyshopifyDomain(credentials.domain);
      if (!domain) throw new Error("Le domaine doit être de la forme ma-boutique.myshopify.com.");
      if (!credentials.accessToken) throw new Error("Domaine et jeton d'accès requis.");
      const creds: ShopifyCredentials = { domain, accessToken: credentials.accessToken };
      await verifyShopifyCredentials(creds);

      await prisma.integration.upsert({
        where: { storeId_provider: { storeId, provider: "SHOPIFY" } },
        create: { storeId, provider: "SHOPIFY", status: "CONNECTED", encryptedCredentials: encryptJson(creds) },
        update: { status: "CONNECTED", encryptedCredentials: encryptJson(creds), lastError: null },
      });
    } else if (provider === "JUDGEME") {
      const shopDomain = normalizeMyshopifyDomain(credentials.shopDomain);
      if (!shopDomain) throw new Error("Le domaine doit être de la forme ma-boutique.myshopify.com.");
      if (!credentials.apiToken) throw new Error("Domaine et jeton API requis.");
      const creds: JudgemeCredentials = { shopDomain, apiToken: credentials.apiToken };
      await verifyJudgemeCredentials(creds);

      await prisma.integration.upsert({
        where: { storeId_provider: { storeId, provider: "JUDGEME" } },
        create: { storeId, provider: "JUDGEME", status: "CONNECTED", encryptedCredentials: encryptJson(creds) },
        update: { status: "CONNECTED", encryptedCredentials: encryptJson(creds), lastError: null },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Le message détaillé (statut HTTP du fournisseur, erreur de chiffrement)
    // reste côté serveur ; l'utilisateur reçoit une cause lisible sans détail interne.
    console.error("[integrations/connect] échec de vérification", { storeId, provider, error: message });
    const userMessage = /myshopify|requis/.test(message) ? message : "Le fournisseur a refusé ces identifiants ou n'a pas répondu. Vérifiez le domaine et le jeton.";
    return NextResponse.json({ error: `Échec de vérification des identifiants : ${userMessage}` }, { status: 400 });
  }

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "integration.connected",
    message: `Intégration ${provider} connectée et vérifiée.`,
  });

  // Première synchronisation immédiate pour donner un retour instantané.
  if (provider === "SHOPIFY") await syncShopify(storeId, "manual");
  if (provider === "JUDGEME") await syncJudgeme(storeId, "manual");

  return NextResponse.json({ ok: true });
}
