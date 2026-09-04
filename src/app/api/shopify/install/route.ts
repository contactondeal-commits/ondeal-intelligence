import { NextRequest, NextResponse } from "next/server";
import { normalizeMyshopifyDomain } from "@/lib/integrations/shopify-domain";
import { buildInstallUrl, signOAuthState } from "@/lib/integrations/shopify-oauth";

// COMMERCIALISATION — point d'entrée "Installer sur Shopify". Un marchand
// arrive ici avec ?shop=ma-boutique.myshopify.com (depuis le lien d'install
// du site public, ou depuis le Shopify App Store une fois listée) et est
// redirigé vers l'écran d'autorisation Shopify. Route GET conforme au
// standard OAuth Shopify (pas d'action destructrice, sans état modifié en base).
export async function GET(req: NextRequest) {
  const shopParam = req.nextUrl.searchParams.get("shop");
  const shop = normalizeMyshopifyDomain(shopParam);
  if (!shop) {
    return NextResponse.json(
      { error: "Paramètre 'shop' manquant ou invalide (attendu : ma-boutique.myshopify.com)." },
      { status: 400 },
    );
  }

  try {
    const state = await signOAuthState(shop);
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
