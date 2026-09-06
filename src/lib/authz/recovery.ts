import crypto from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — second facteur de récupération (06/09/2026).
 *
 * 10 codes à usage unique générés UNE SEULE FOIS, à l'enregistrement de la
 * PREMIÈRE clé WebAuthn de l'Owner — jamais régénérés silencieusement
 * (regénérer révoque explicitement les anciens, voir regenerateRecoveryCodes).
 * Hashés en base (sha256) — jamais stockés en clair, jamais renvoyés après
 * cette première génération (impossible de les "consulter" plus tard,
 * seulement de les régénérer, ce qui invalide les précédents).
 */

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function formatCode(raw: Buffer): string {
  // XXXX-XXXX-XXXX, alphabet réduit (pas de 0/O/1/I ambigus) — lisible et copiable à la main.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[(raw[i] ?? 0) % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  await prisma.platformOwnerRecoveryCode.deleteMany({ where: { userId, usedAt: null } }); // régénérer invalide explicitement tout code non consommé précédent
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const code = formatCode(crypto.randomBytes(12));
    codes.push(code);
    await prisma.platformOwnerRecoveryCode.create({ data: { userId, codeHash: hashCode(code) } });
  }
  return codes; // affichés UNE SEULE FOIS par l'appelant (route API) — jamais journalisés, jamais renvoyés par un GET ultérieur
}

export async function remainingRecoveryCodeCount(userId: string): Promise<number> {
  return prisma.platformOwnerRecoveryCode.count({ where: { userId, usedAt: null } });
}

/** Consomme UN code s'il est valide et non déjà utilisé — jamais réutilisable ensuite. */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const hash = hashCode(code.trim().toUpperCase());
  const row = await prisma.platformOwnerRecoveryCode.findFirst({ where: { userId, codeHash: hash, usedAt: null } });
  if (!row) return false;
  await prisma.platformOwnerRecoveryCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return true;
}
