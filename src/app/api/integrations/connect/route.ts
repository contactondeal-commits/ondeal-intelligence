import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireStoreAccess, requireRole, ADMIN_ROLES, AuthError } from "@/lib/auth";
import { encryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { verifyShopifyCredentials, type ShopifyCredentials } from "@/lib/integrations/shopify";
import { verifyJudgemeCredentials, type JudgemeCredentials } from "@/lib/integrations/judgeme";
import { verifyWooCommerceCredentials, type WooCommerceCredentials } from "@/lib/integrations/woocommerce";
import { verifyPrestaShopCredentials, type PrestaShopCredentials } from "@/lib/integrations/prestashop";
import { verifyCjCredentials, type CjCredentials } from "@/lib/integrations/cjdropshipping";
import { syncCatalog, syncJudgeme } from "@/lib/sync/pipeline";

// PHASE 17/18 — Connexion d'une intégration. Les credentials sont
// VÉRIFIÉS en direct auprès du fournisseur avant d'être chiffrés et
// stockés. Aucun credential n'est jamais inventé ou pré-rempli : l'échec de
// vérification bloque la connexion avec un message clair.
// SÉCURITÉ (04/09/2026) — le domaine Shopify est strictement contraint à
// `*.myshopify.com` : l'app n'effectue jamais de requête sortante vers un
// hôte arbitraire fourni par un utilisateur (anti-SSRF).
const MYSHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/i;

const CATALOG_PROVIDERS = ["SHOPIFY", "WOOCOMMERCE", "PRESTASHOP"] as const;
type CatalogProvider = (typeof CATALOG_PROVIDERS)[number];

const bodySchema = z
  .object({
    storeId: z.string().min(1).max(64),
    provider: z.enum(["SHOPIFY", "JUDGEME", "WOOCOMMERCE", "PRESTASHOP", "CJDROPSHIPPING"]),
    credentials: z
      .object({
        domain: z.string().trim().max(253).optional(),
        accessToken: z.string().trim().max(512).optional(),
        shopDomain: z.string().trim().max(253).optional(),
        apiToken: z.string().trim().max(512).optional(),
        siteUrl: z.string().trim().max(253).optional(),
        consumerKey: z.string().trim().max(512).optional(),
        consumerSecret: z.string().trim().max(512).optional(),
        apiKey: z.string().trim().max(512).optional(),
      })
      .strict(),
  })
  .strict();

function normalizeMyshopifyDomain(raw: string | undefined): string | null {
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  return MYSHOPIFY_DOMAIN.test(host) ? host : null;
}

// WOOCOMMERCE/PRESTASHOP (04/09/2026) — anti-SSRF pour une URL de site
// FOURNIE PAR L'UTILISATEUR (contrairement au domaine Shopify, contraint à
// *.myshopify.com, ces plateformes s'installent sur n'importe quel domaine
// arbitraire — impossible d'exiger un suffixe fixe). Bloque l'hôte local et
// les plages d'adresses privées les plus courantes (protection best-effort
// par filtrage littéral, PAS une résolution DNS — documenté comme tel,
// jamais présenté comme une garantie exhaustive contre le SSRF via DNS
// rebinding). Exige HTTPS : ces identifiants ne doivent jamais transiter en clair.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /\.local$/i,
  /\.internal$/i,
];

function normalizeExternalSiteUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(host))) return null;
  return `${url.protocol}//${url.host}`;
}

function isCatalogProvider(provider: string): provider is CatalogProvider {
  return (CATALOG_PROVIDERS as readonly string[]).includes(provider);
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

  // Un Store n'a JAMAIS plus d'une intégration CATALOGUE connectée à la fois
  // (SHOPIFY/WOOCOMMERCE/PRESTASHOP) — les mélanger doublerait le catalogue
  // sans avertissement. Vérifié ICI, avant toute vérification fournisseur.
  if (isCatalogProvider(provider)) {
    const existingOther = await prisma.integration.findFirst({
      where: {
        storeId,
        provider: { in: CATALOG_PROVIDERS.filter((p) => p !== provider) },
        status: "CONNECTED",
      },
    });
    if (existingOther) {
      return NextResponse.json(
        {
          error: `Cette boutique a déjà une intégration catalogue connectée (${existingOther.provider}). Déconnectez-la d'abord (Paramètres > Intégrations) avant d'en connecter une autre — mélanger deux catalogues créerait des doublons.`,
        },
        { status: 409 },
      );
    }
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
    } else if (provider === "WOOCOMMERCE") {
      const siteUrl = normalizeExternalSiteUrl(credentials.siteUrl);
      if (!siteUrl) throw new Error("L'adresse du site doit être une URL HTTPS valide (ex. https://ma-boutique.com).");
      if (!credentials.consumerKey || !credentials.consumerSecret) throw new Error("Clé et secret consommateur requis.");
      const creds: WooCommerceCredentials = { siteUrl, consumerKey: credentials.consumerKey, consumerSecret: credentials.consumerSecret };
      await verifyWooCommerceCredentials(creds);

      await prisma.integration.upsert({
        where: { storeId_provider: { storeId, provider: "WOOCOMMERCE" } },
        create: { storeId, provider: "WOOCOMMERCE", status: "CONNECTED", encryptedCredentials: encryptJson(creds) },
        update: { status: "CONNECTED", encryptedCredentials: encryptJson(creds), lastError: null },
      });
    } else if (provider === "PRESTASHOP") {
      const siteUrl = normalizeExternalSiteUrl(credentials.siteUrl);
      if (!siteUrl) throw new Error("L'adresse du site doit être une URL HTTPS valide (ex. https://ma-boutique.fr).");
      if (!credentials.apiToken) throw new Error("Clé Webservice requise.");
      const creds: PrestaShopCredentials = { siteUrl, apiKey: credentials.apiToken };
      await verifyPrestaShopCredentials(creds);

      await prisma.integration.upsert({
        where: { storeId_provider: { storeId, provider: "PRESTASHOP" } },
        create: { storeId, provider: "PRESTASHOP", status: "CONNECTED", encryptedCredentials: encryptJson(creds) },
        update: { status: "CONNECTED", encryptedCredentials: encryptJson(creds), lastError: null },
      });
    } else if (provider === "CJDROPSHIPPING") {
      // Fournisseur, PAS un connecteur catalogue — jamais soumis à la
      // contrainte "un seul catalogue à la fois" ci-dessus (isCatalogProvider
      // renvoie false pour CJDROPSHIPPING).
      if (!credentials.apiKey) throw new Error("Clé API CJ requise.");
      const creds: CjCredentials = { apiKey: credentials.apiKey };
      await verifyCjCredentials(creds);

      await prisma.integration.upsert({
        where: { storeId_provider: { storeId, provider: "CJDROPSHIPPING" } },
        create: { storeId, provider: "CJDROPSHIPPING", status: "CONNECTED", encryptedCredentials: encryptJson(creds) },
        update: { status: "CONNECTED", encryptedCredentials: encryptJson(creds), lastError: null },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Le message détaillé (statut HTTP du fournisseur, erreur de chiffrement)
    // reste côté serveur ; l'utilisateur reçoit une cause lisible sans détail interne.
    console.error("[integrations/connect] échec de vérification", { storeId, provider, error: message });
    const userMessage = /myshopify|requis|HTTPS/.test(message)
      ? message
      : "Le fournisseur a refusé ces identifiants ou n'a pas répondu. Vérifiez l'adresse et les clés.";
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
  if (isCatalogProvider(provider)) await syncCatalog(storeId, "manual");
  if (provider === "JUDGEME") await syncJudgeme(storeId, "manual");

  return NextResponse.json({ ok: true });
}
