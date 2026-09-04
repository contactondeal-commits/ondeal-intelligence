import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyShopifyWebhookHmac } from "@/lib/integrations/shopify-oauth";
import { logAudit } from "@/lib/audit";

// WEBHOOK OBLIGATOIRE (conformité) — shop/redact. Envoyé par Shopify 48h
// après la désinstallation : toutes les données de la boutique doivent être
// effacées. Suppression RÉELLE (exigence légale) de l'enregistrement Store —
// la cascade Prisma (onDelete: Cascade, voir schema.prisma) supprime alors
// produits, variantes, commandes, avis, scores, recommandations, actions,
// synchronisations et intégrations liés. L'Organization et le compte
// utilisateur (pouvant couvrir d'autres boutiques) ne sont PAS supprimés ici.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(rawBody, hmac)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  let payload: { shop_domain?: string } = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const shopDomain = payload.shop_domain ?? req.headers.get("x-shopify-shop-domain");
  if (shopDomain) {
    const store = await prisma.store.findFirst({ where: { domain: shopDomain } });
    if (store) {
      // Trace l'effacement AVANT suppression (l'AuditLog du store disparaît
      // avec lui — la trace définitive de cette action légale doit rester
      // consultable indépendamment ; consignée ici dans les logs serveur).
      console.warn("[compliance] shop/redact — suppression définitive des données", {
        storeId: store.id,
        shopDomain,
      });
      await prisma.store.delete({ where: { id: store.id } });
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
