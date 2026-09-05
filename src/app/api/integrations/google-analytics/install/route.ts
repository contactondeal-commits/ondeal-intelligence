import { NextRequest, NextResponse } from "next/server";
import { requireStoreAccess, requireRole, ADMIN_ROLES, AuthError } from "@/lib/auth";
import { buildGaInstallUrl, signGaOAuthState } from "@/lib/integrations/google-analytics";

// GOOGLE ANALYTICS — point d'entrée "Connecter Google Analytics" depuis
// Paramètres > Intégrations. Toujours un rattachement à une boutique OnDeal
// déjà existante (pas de flux "installation depuis Google", contrairement à
// Shopify) : l'accès est vérifié ICI, avant de signer l'état — jamais fait
// confiance à un storeId non vérifié transmis jusqu'au callback (qui
// revérifie de toute façon après le retour de Google).
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("store");
  if (!storeId) {
    return NextResponse.json({ error: "Paramètre 'store' manquant." }, { status: 400 });
  }

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
    const state = await signGaOAuthState(storeId, userId);
    const installUrl = buildGaInstallUrl(state);
    return NextResponse.redirect(installUrl, { status: 302 });
  } catch (err) {
    console.error("[google-analytics/install] configuration manquante", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Connexion Google Analytics indisponible pour le moment (configuration serveur incomplète)." },
      { status: 503 },
    );
  }
}
