import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { encryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import type { ShopifyCredentials } from "@/lib/integrations/shopify";
import { registerMandatoryWebhooks, type ShopInfo } from "@/lib/integrations/shopify-oauth";

// COMMERCIALISATION — logique de provisioning partagée entre le flux OAuth
// classique (/api/shopify/callback) et le flux embarqué (App Bridge, voir
// /api/shopify/session-token-exchange) : retrouve ou crée Organization /
// Store / Integration / User / Membership, enregistre les webhooks
// obligatoires, journalise. Un Store existant conserve tout son historique
// (produits, décisions, audit) — jamais recréé de zéro à la réinstallation.

export interface ProvisionResult {
  storeId: string;
  userId: string;
  userEmail: string;
}

export async function provisionStoreFromShopifyAuth(params: {
  shop: string;
  creds: ShopifyCredentials;
  scope: string;
  shopInfo: ShopInfo;
  event: string;
  message: string;
}): Promise<ProvisionResult> {
  const { shop, creds, scope, shopInfo, event, message } = params;

  let store = await prisma.store.findFirst({ where: { domain: shop } });
  let organizationId: string;

  if (store) {
    organizationId = store.organizationId;
  } else {
    const organization = await prisma.organization.create({
      data: { name: shopInfo.name || shop, plan: "STARTER" },
    });
    organizationId = organization.id;
    store = await prisma.store.create({
      data: { organizationId, name: shopInfo.name || shop, domain: shop },
    });
  }

  await prisma.store.update({ where: { id: store.id }, data: { shopifyGrantedScope: scope } });

  await prisma.integration.upsert({
    where: { storeId_provider: { storeId: store.id, provider: "SHOPIFY" } },
    create: { storeId: store.id, provider: "SHOPIFY", status: "CONNECTED", encryptedCredentials: encryptJson(creds) },
    update: { status: "CONNECTED", encryptedCredentials: encryptJson(creds), lastError: null },
  });

  // Utilisateur lié à l'installation. Un marchand qui installe via
  // OAuth/App Bridge n'a jamais saisi de mot de passe OnDeal — un hash
  // aléatoire inutilisable est stocké (le champ est requis en base) ; ce
  // compte ne se connecte que via ces flux Shopify.
  let user = shopInfo.email ? await prisma.user.findUnique({ where: { email: shopInfo.email } }) : null;
  if (!user) {
    const unusablePassword = await hashPassword(crypto.randomBytes(32).toString("hex"));
    user = await prisma.user.create({
      data: {
        email: shopInfo.email ?? `${shop}@shopify-install.ondeal.internal`,
        passwordHash: unusablePassword,
        name: shopInfo.name || shop,
      },
    });
  }

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId } },
    create: { userId: user.id, organizationId, role: "OWNER" },
    update: {},
  });

  // Best-effort par webhook — un échec isolé est loggé sans bloquer
  // l'installation (voir registerMandatoryWebhooks).
  await registerMandatoryWebhooks(creds, store.id);

  await logAudit({ storeId: store.id, userId: user.id, actorType: "system", event, message });

  return { storeId: store.id, userId: user.id, userEmail: user.email };
}

/**
 * Connecte Shopify (OAuth) à une boutique OnDeal DÉJÀ EXISTANTE, sans créer
 * de nouvelle Organization/Store ni toucher la session en cours (04/09/2026
 * — chemin "Connecter via Shopify" depuis Paramètres > Intégrations, pour un
 * compte créé manuellement). Distincte de provisionStoreFromShopifyAuth,
 * qui retrouve/crée par domaine + bascule la session sur l'e-mail Shopify :
 * inadapté ici, ça aurait déconnecté le marchand de son propre compte.
 * L'accès à `storeId` doit avoir déjà été vérifié par l'appelant
 * (requireStoreAccess) — cette fonction ne revérifie pas l'autorisation.
 */
export async function attachShopifyToExistingStore(params: {
  storeId: string;
  userId: string;
  shop: string;
  creds: ShopifyCredentials;
  scope: string;
}): Promise<void> {
  const { storeId, userId, shop, creds, scope } = params;

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new Error("Boutique OnDeal introuvable.");

  // Un autre Store ne doit jamais déjà revendiquer ce domaine Shopify —
  // éviterait de mélanger silencieusement l'historique de deux boutiques.
  const conflict = await prisma.store.findFirst({ where: { domain: shop, NOT: { id: storeId } } });
  if (conflict) {
    throw new Error(
      `${shop} est déjà connectée à une autre boutique OnDeal (${conflict.name}). Déconnectez-la d'abord si vous voulez la reconnecter ici.`,
    );
  }

  await prisma.store.update({ where: { id: storeId }, data: { domain: shop, shopifyGrantedScope: scope } });

  await prisma.integration.upsert({
    where: { storeId_provider: { storeId, provider: "SHOPIFY" } },
    create: { storeId, provider: "SHOPIFY", status: "CONNECTED", encryptedCredentials: encryptJson(creds) },
    update: { status: "CONNECTED", encryptedCredentials: encryptJson(creds), lastError: null },
  });

  await registerMandatoryWebhooks(creds, storeId);

  await logAudit({
    storeId,
    userId,
    actorType: "user",
    event: "integration.oauth_installed",
    message: `Boutique Shopify ${shop} connectée via OAuth (compte existant).`,
  });
}
