import { NextRequest, NextResponse } from "next/server";
import { normalizeMyshopifyDomain } from "@/lib/integrations/shopify-domain";
import { buildInstallUrl, signOAuthState } from "@/lib/integrations/shopify-oauth";
import { requireStoreAccess, AuthError } from "@/lib/auth";

// COMMERCIALISATION — point d'entrée "Installer sur Shopify". Un marchand
// arrive ici avec ?shop=ma-boutique.myshopify.com (depuis le lien d'install
// du site public, ou depuis le Shopify App Store une fois listée) et est
// redirigé vers l'écran d'autorisation Shopify. Route GET conforme au
// standard OAuth Shopify (pas d'action destructrice, sans état modifié en base).
//
// `linkStoreId` (optionnel) — ajouté 04/09/2026 : un marchand déjà connecté
// à un compte OnDeal existant (créé manuellement) qui clique "Connecter via
// Shopify" depuis Paramètres > Intégrations. L'accès à cette boutique est
// vérifié ICI, AVANT de signer l'état — jamais fait confiance à une valeur
// non vérifiée transmise jusqu'au callback (voir /api/shopify/callback, qui
// revérifie de toute façon après le retour de Shopify).
export async function GET(req: NextRequest) {
  const shopParam = req.nextUrl.searchParams.get("shop");
  const shop = normalizeMyshopifyDomain(shopParam);
  if (!shop) {
    return NextResponse.json(
      { error: "Paramètre 'shop' manquant ou invalide (attendu : ma-boutique.myshopify.com)." },
      { status: 400 },
    );
  }

  const linkStoreIdParam = req.nextUrl.searchParams.get("linkStoreId");
  let linkStoreId: string | undefined;
  if (linkStoreIdParam) {
    try {
      await requireStoreAccess(linkStoreIdParam);
      linkStoreId = linkStoreIdParam;
    } catch (err) {
      const status = err instanceof AuthError ? 403 : 500;
      return NextResponse.json({ error: "Vous n'avez pas accès à cette boutique OnDeal." }, { status });
    }
  }

  try {
    const state = await signOAuthState(shop, linkStoreId);
    const installUrl = buildInstallUrl(shop, state);
    return NextResponse.redirect(installUrl, { status: 302 });
  } catch (err) {
    console.error("[shopify/install] configuration manquante", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Installation Shopify indisponible pour le moment (configuration serveur incomplète)." },
      { status: 503 },
    );
  }
}
