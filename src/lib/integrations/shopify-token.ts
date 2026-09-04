import type { Integration } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import type { ShopifyCredentials } from "@/lib/integrations/shopify";
import { refreshOfflineAccessToken } from "@/lib/integrations/shopify-embedded";

// CORRECTIF PRODUCTION (04/09/2026) — voir shopify-embedded.ts : le flux app
// embarquée (App Bridge) demande un jeton EXPIRANT (`expiring=1`, requis par
// Shopify pour une app publique récente) mais aucun code n'en renouvelait le
// refresh_token — chaque jeton mourait silencieusement ~1h après l'échange,
// avec 401 sur le prochain appel Admin API. Ce module centralise le SEUL
// point de lecture des credentials Shopify utilisable en dehors d'un échange
// initial : tout appelant qui a besoin d'appeler l'Admin API pour une
// Integration déjà CONNECTED doit passer par `getFreshShopifyCredentials`,
// jamais décrypter `encryptedCredentials` directement.

// Marge de sécurité avant l'expiration réelle — on rafraîchit PROACTIVEMENT
// avant qu'une requête en cours ne puisse échouer en plein milieu (pratique
// documentée par Shopify : rafraîchir quelques minutes avant l'échéance,
// jamais réactivement seulement sur un 401).
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Déchiffre les credentials Shopify d'une Integration DÉJÀ chargée par
 * l'appelant (qui a déjà vérifié `status === "CONNECTED"` et
 * `encryptedCredentials` non nul) et les rafraîchit si nécessaire.
 *
 * Un jeton CLASSIQUE non-expirant (flux OAuth historique sans `expiring`,
 * ou jeton saisi manuellement — `expiresAt` absent) est retourné tel quel,
 * sans aucun appel réseau supplémentaire : comportement strictement
 * inchangé pour ce cas, c'était déjà celui de tous les appelants avant ce
 * correctif.
 *
 * Un jeton EXPIRANT encore valide (marge de sécurité incluse) est lui aussi
 * retourné tel quel. Seul un jeton expirant proche de l'échéance ou déjà
 * expiré déclenche un renouvellement, dont le résultat est persisté avant
 * d'être retourné — pour que l'appel Admin API qui suit immédiatement
 * utilise systématiquement un jeton frais.
 */
export async function getFreshShopifyCredentials(
  integration: Pick<Integration, "id" | "storeId" | "encryptedCredentials">,
): Promise<ShopifyCredentials> {
  const creds = decryptJson<ShopifyCredentials>(integration.encryptedCredentials!);

  if (!creds.expiresAt || !creds.refreshToken) return creds;
  if (Date.now() < creds.expiresAt - REFRESH_SAFETY_MARGIN_MS) return creds;

  try {
    const refreshed = await refreshOfflineAccessToken(creds.domain, creds.refreshToken);
    const nextCreds: ShopifyCredentials = {
      domain: creds.domain,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? creds.refreshToken,
      expiresAt: refreshed.expiresAt,
    };
    await prisma.integration.update({
      where: { id: integration.id },
      data: { encryptedCredentials: encryptJson(nextCreds), status: "CONNECTED", lastError: null },
    });
    await logAudit({
      storeId: integration.storeId,
      actorType: "system",
      event: "integration.token_refreshed",
      message: `Jeton d'accès Shopify renouvelé automatiquement pour ${creds.domain} (jeton expirant, ~1h de durée de vie).`,
    });
    return nextCreds;
  } catch (err) {
    // Repasse l'Integration en ERROR avec le détail réel (ex. invalid_grant
    // = refresh_token expiré après 90 jours d'inactivité ou révoqué) —
    // jamais laissée silencieusement sur un statut CONNECTED trompeur.
    const message = err instanceof Error ? err.message : String(err);
    await prisma.integration.update({
      where: { id: integration.id },
      data: { status: "ERROR", lastError: `Renouvellement du jeton Shopify échoué : ${message}` },
    });
    throw new Error(
      `Le jeton d'accès Shopify a expiré et n'a pas pu être renouvelé automatiquement (${message}) — reconnectez la boutique (Paramètres > Intégrations).`,
    );
  }
}
