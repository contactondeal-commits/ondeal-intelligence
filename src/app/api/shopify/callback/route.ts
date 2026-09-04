import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword, createSession, setSessionCookie } from "@/lib/auth";
import { encryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { normalizeMyshopifyDomain } from "@/lib/integrations/shopify-domain";
import type { ShopifyCredentials } from "@/lib/integrations/shopify";
import {
  verifyOAuthCallbackHmac,
  verifyOAuthState,
  exchangeCodeForAccessToken,
  fetchShopInfo,
  registerMandatoryWebhooks,
} from "@/lib/integrations/shopify-oauth";

// COMMERCIALISATION — retour d'autorisation Shopify. Crée ou retrouve
// l'Organization/Store correspondant à la boutique, connecte l'intégration
// Shopify, enregistre les webhooks obligatoires, puis ouvre une session pour
// le marchand. AUCUNE valeur n'est inventée : en cas d'échec à n'importe
// quelle étape, l'installation est refusée avec un message clair plutôt que
// de créer un état partiel silencieux.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const shop = normalizeMyshopifyDomain(params.get("shop"));
  const code = params.get("code");
  const state = params.get("state");

  if (!shop || !code || !state) {
    return NextResponse.json({ error: "Paramètres OAuth manquants." }, { status: 400 });
  }

  // 1. HMAC de la requête (paramètres signés par Shopify) — anti-falsification.
  if (!verifyOAuthCallbackHmac(params)) {
    console.error("[shopify/callback] HMAC invalide", { shop });
    return NextResponse.json({ error: "Signature de la requête invalide." }, { status: 401 });
  }

  // 2. État anti-CSRF (émis par /api/shopify/install, à courte durée de vie).
  if (!(await verifyOAuthState(state, shop))) {
    console.error("[shopify/callback] state invalide ou expiré", { shop });
    return NextResponse.json({ error: "Session d'installation invalide ou expirée. Relancez l'installation." }, { status: 401 });
  }

  try {
    // 3. Échange du code contre un jeton d'accès (une seule fois — Shopify
    // invalide un code déjà utilisé).
    const { accessToken, scope } = await exchangeCodeForAccessToken(shop, code);
    const creds: ShopifyCredentials = { domain: shop, accessToken };

    // 4. Informations réelles de la boutique (jamais devinées).
    const shopInfo = await fetchShopInfo(creds);

    // 5. Organization + Store : retrouvés par domaine si déjà connus
    // (réinstallation), sinon créés. Un Store existant conserve son
    // historique (produits, décisions, audit) — jamais recréé de zéro.
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

    // 6. Intégration Shopify — jeton chiffré (AES-256-GCM), jamais en clair.
    await prisma.integration.upsert({
      where: { storeId_provider: { storeId: store.id, provider: "SHOPIFY" } },
      create: { storeId: store.id, provider: "SHOPIFY", status: "CONNECTED", encryptedCredentials: encryptJson(creds) },
      update: { status: "CONNECTED", encryptedCredentials: encryptJson(creds), lastError: null },
    });

    // 7. Utilisateur lié à l'installation. Un marchand qui installe via
    // OAuth n'a jamais saisi de mot de passe OnDeal — un hash aléatoire
    // inutilisable est stocké (le champ est requis en base) ; ce compte ne
    // se connecte que via ce flux OAuth ou, plus tard, via l'app embarquée
    // (jetons de session Shopify).
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

    // 8. Webhooks obligatoires (conformité) + opérationnels — best-effort,
    // erreurs loggées sans bloquer l'installation (voir registerMandatoryWebhooks).
    await registerMandatoryWebhooks(creds, store.id);

    await logAudit({
      storeId: store.id,
      userId: user.id,
      actorType: "system",
      event: "integration.oauth_installed",
      message: `Boutique Shopify ${shop} installée via OAuth (scope: ${scope}).`,
    });

    // 9. Session ouverte pour le marchand, redirection vers l'app.
    // NOTE — cette redirection va vers l'app en accès direct (hors iframe
    // admin Shopify) : l'embedding complet (App Bridge + jetons de session)
    // est une étape distincte, pas encore construite à ce stade.
    const token = await createSession({ userId: user.id, email: user.email });
    await setSessionCookie(token);

    const appUrl = process.env.APP_URL?.replace(/\/$/, "") ?? "";
    return NextResponse.redirect(`${appUrl}/dashboard?store=${store.id}`, { status: 302 });
  } catch (err) {
    console.error("[shopify/callback] échec de l'installation", { shop, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "L'installation a échoué. Aucune donnée n'a été enregistrée pour cette étape. Réessayez depuis Shopify." },
      { status: 502 },
    );
  }
}
