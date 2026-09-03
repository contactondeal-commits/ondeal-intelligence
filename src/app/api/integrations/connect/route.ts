import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";
import { encryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { verifyShopifyCredentials, type ShopifyCredentials } from "@/lib/integrations/shopify";
import { verifyJudgemeCredentials, type JudgemeCredentials } from "@/lib/integrations/judgeme";
import { syncShopify, syncJudgeme } from "@/lib/sync/pipeline";

// PHASE 17/18 — Connexion d'une intégration. Les credentials sont
// VÉRIFIÉS en direct auprès du fournisseur avant d'être chiffrés et
// stockés. Aucun credential n'est jamais inventé ou pré-rempli : l'échec de
// vérification bloque la connexion avec un message clair.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { storeId, provider, credentials } = body ?? {};
  if (!storeId || !provider || !credentials) return NextResponse.json({ error: "Champs manquants." }, { status: 400 });

  let userId: string;
  try {
    ({ userId } = await requireStoreAccess(storeId));
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  try {
    if (provider === "SHOPIFY") {
      const creds: ShopifyCredentials = { domain: credentials.domain, accessToken: credentials.accessToken };
      if (!creds.domain || !creds.accessToken) throw new Error("Domaine et jeton d'accès requis.");
      await verifyShopifyCredentials(creds);

      await prisma.integration.upsert({
        where: { storeId_provider: { storeId, provider: "SHOPIFY" } },
        create: { storeId, provider: "SHOPIFY", status: "CONNECTED", encryptedCredentials: encryptJson(creds) },
        update: { status: "CONNECTED", encryptedCredentials: encryptJson(creds), lastError: null },
      });
    } else if (provider === "JUDGEME") {
      const creds: JudgemeCredentials = { shopDomain: credentials.shopDomain, apiToken: credentials.apiToken };
      if (!creds.shopDomain || !creds.apiToken) throw new Error("Domaine et jeton API requis.");
      await verifyJudgemeCredentials(creds);

      await prisma.integration.upsert({
        where: { storeId_provider: { storeId, provider: "JUDGEME" } },
        create: { storeId, provider: "JUDGEME", status: "CONNECTED", encryptedCredentials: encryptJson(creds) },
        update: { status: "CONNECTED", encryptedCredentials: encryptJson(creds), lastError: null },
      });
    } else {
      return NextResponse.json({ error: "Fournisseur inconnu." }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Échec de vérification des identifiants : ${message}` }, { status: 400 });
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
