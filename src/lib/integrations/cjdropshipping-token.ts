import type { Integration } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { type CjCredentials, requestCjAccessToken, refreshCjAccessToken } from "@/lib/integrations/cjdropshipping";

// CORRECTIF PRODUCTION (05/09/2026) — voir cjdropshipping.ts pour le contexte
// complet : la clé du tableau de bord CJ doit être échangée contre un
// accessToken (15 jours) avant tout appel. Ce module centralise le SEUL
// point de lecture des credentials CJ utilisable en dehors de la connexion
// initiale (voir shopify-token.ts pour le précédent exact appliqué à
// Shopify) : tout appelant qui a besoin d'interroger l'API CJ pour une
// Integration déjà CONNECTED doit passer par `getFreshCjCredentials`, jamais
// décrypter `encryptedCredentials` directement.

// Marge de sécurité avant l'expiration réelle — mêmes principes que
// shopify-token.ts : renouveler proactivement plutôt que réactivement sur
// une erreur en plein milieu d'exécution.
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

function isStillValid(expiresAt: number | undefined): boolean {
  return typeof expiresAt === "number" && Date.now() < expiresAt - REFRESH_SAFETY_MARGIN_MS;
}

/**
 * Déchiffre les credentials CJ d'une Integration DÉJÀ chargée par l'appelant
 * (qui a déjà vérifié `status === "CONNECTED"` et `encryptedCredentials` non
 * nul) et renouvelle l'accessToken si nécessaire, en persistant le résultat
 * avant de le retourner.
 *
 * Contrairement à Shopify, un échec de renouvellement via `refreshToken` ne
 * force PAS de reconnexion manuelle immédiate : la clé du tableau de bord CJ
 * (`apiKey`) ne change jamais côté fournisseur, donc elle sert de filet de
 * sécurité pour redériver un accessToken directement. Seul un échec de CE
 * dernier recours (clé elle-même invalide/révoquée) repasse l'Integration en
 * ERROR et demande une reconnexion.
 */
export async function getFreshCjCredentials(
  integration: Pick<Integration, "id" | "storeId" | "encryptedCredentials">,
): Promise<CjCredentials> {
  const creds = decryptJson<CjCredentials>(integration.encryptedCredentials!);

  if (isStillValid(creds.accessTokenExpiresAt) && creds.accessToken) return creds;

  let bundle;
  try {
    bundle =
      creds.refreshToken && isStillValid(creds.refreshTokenExpiresAt)
        ? await refreshCjAccessToken(creds.refreshToken)
        : await requestCjAccessToken(creds.apiKey);
  } catch {
    // Dernier recours : le refreshToken a pu être révoqué/invalidé côté CJ
    // avant son échéance documentée — la clé du tableau de bord, elle,
    // reste utilisable tant qu'elle n'a pas été régénérée par l'utilisateur.
    try {
      bundle = await requestCjAccessToken(creds.apiKey);
    } catch (finalErr) {
      const message = finalErr instanceof Error ? finalErr.message : String(finalErr);
      await prisma.integration.update({
        where: { id: integration.id },
        data: { status: "ERROR", lastError: `Renouvellement du jeton CJdropshipping échoué : ${message}` },
      });
      throw new Error(
        `Le jeton d'accès CJdropshipping n'a pas pu être renouvelé (${message}) — reconnectez CJdropshipping (Paramètres > Intégrations).`,
      );
    }
  }

  const nextCreds: CjCredentials = {
    apiKey: creds.apiKey,
    accessToken: bundle.accessToken,
    accessTokenExpiresAt: bundle.accessTokenExpiresAt,
    refreshToken: bundle.refreshToken,
    refreshTokenExpiresAt: bundle.refreshTokenExpiresAt,
  };
  await prisma.integration.update({
    where: { id: integration.id },
    data: { encryptedCredentials: encryptJson(nextCreds), status: "CONNECTED", lastError: null },
  });
  await logAudit({
    storeId: integration.storeId,
    actorType: "system",
    event: "integration.token_refreshed",
    message: "Jeton d'accès CJdropshipping renouvelé automatiquement (jeton d'accès valable 15 jours).",
  });
  return nextCreds;
}
