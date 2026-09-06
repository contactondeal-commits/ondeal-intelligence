import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransport,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/db";

/**
 * ONDEAL AI CORE — OWNER STRONG AUTHENTICATION (06/09/2026).
 *
 * Enveloppe RÉELLE de @simplewebauthn/server (implémentation FIDO2/WebAuthn
 * de référence, jamais une cryptographie maison) — ce fichier ne fait QUE
 * fournir la config RP (relying party) et persister/relire les credentials
 * réels via Prisma. Aucune biométrie ni clé privée ne transite ni n'est
 * stockée ici : seule la clé PUBLIQUE COSE renvoyée par l'authenticator
 * (PlatformOwnerCredential.publicKey) — le principe même de FIDO2.
 *
 * rpID = le nom d'hôte de APP_URL (jamais un domaine différent — WebAuthn
 * lie cryptographiquement une clé à une origine, un rpID incorrect ferait
 * échouer TOUTE cérémonie côté navigateur, jamais un échec silencieux).
 */

function rpConfig(): { rpID: string; rpName: string; origin: string } {
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error("APP_URL manquant — requis pour configurer WebAuthn (rpID/origin).");
  const url = new URL(appUrl);
  return { rpID: url.hostname, rpName: "OnDeal AI Lab — Platform Owner", origin: appUrl };
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes — une cérémonie non terminée dans ce délai doit être relancée, jamais rejouable après (anti-replay FIDO2)

export async function storeChallenge(userId: string, kind: "REGISTRATION" | "AUTHENTICATION" | "STEP_UP", challenge: string): Promise<void> {
  // Une seule cérémonie en cours par (userId, kind) — une nouvelle invalide l'ancienne (jamais deux challenges valides simultanés pour le même but).
  await prisma.platformOwnerWebAuthnChallenge.deleteMany({ where: { userId, kind } });
  await prisma.platformOwnerWebAuthnChallenge.create({
    data: { userId, kind, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });
}

async function consumeChallenge(userId: string, kind: "REGISTRATION" | "AUTHENTICATION" | "STEP_UP"): Promise<string> {
  const row = await prisma.platformOwnerWebAuthnChallenge.findFirst({ where: { userId, kind }, orderBy: { createdAt: "desc" } });
  if (!row) throw new Error("Aucune cérémonie WebAuthn en cours pour cet utilisateur — relancez depuis le début.");
  await prisma.platformOwnerWebAuthnChallenge.delete({ where: { id: row.id } }); // anti-replay : un challenge n'est jamais réutilisable, consommé même en cas d'échec de vérification ensuite
  if (row.expiresAt.getTime() < Date.now()) throw new Error("Cérémonie WebAuthn expirée (> 5 min) — relancez depuis le début.");
  return row.challenge;
}

export async function buildRegistrationOptions(userId: string, userEmail: string) {
  const { rpID, rpName } = rpConfig();
  const existing = await prisma.platformOwnerCredential.findMany({ where: { userId, revokedAt: null } });
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(userId),
    userName: userEmail,
    attestationType: "none", // pas besoin de la chaîne d'attestation fabricant pour ce cas d'usage — réduit la friction UX sans affaiblir la garantie FIDO2 (possession + biométrie/PIN locale)
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransport[]) : undefined })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" }, // userVerification required = biométrie/PIN local RÉELLEMENT exigé par l'authenticator, jamais seulement "présence"
  });
  await storeChallenge(userId, "REGISTRATION", options.challenge);
  return options;
}

export async function verifyRegistration(userId: string, deviceLabel: string, response: RegistrationResponseJSON) {
  const { rpID, origin } = rpConfig();
  const expectedChallenge = await consumeChallenge(userId, "REGISTRATION");
  const verification = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  if (!verification.verified || !verification.registrationInfo) throw new Error("Vérification d'enregistrement WebAuthn échouée.");

  const { credential } = verification.registrationInfo;
  await prisma.platformOwnerCredential.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      deviceLabel: deviceLabel.slice(0, 120) || "Clé sans nom",
    },
  });
}

export async function buildAuthenticationOptions(userId: string, kind: "AUTHENTICATION" | "STEP_UP" = "AUTHENTICATION") {
  const { rpID } = rpConfig();
  const credentials = await prisma.platformOwnerCredential.findMany({ where: { userId, revokedAt: null } });
  if (credentials.length === 0) throw new Error("Aucune clé WebAuthn enregistrée pour ce compte Platform Owner — enregistrez-en une d'abord.");
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: credentials.map((c) => ({ id: c.credentialId, transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransport[]) : undefined })),
  });
  await storeChallenge(userId, kind, options.challenge);
  return options;
}

export async function verifyAuthentication(userId: string, response: AuthenticationResponseJSON, kind: "AUTHENTICATION" | "STEP_UP" = "AUTHENTICATION"): Promise<{ credentialId: string }> {
  const { rpID, origin } = rpConfig();
  const expectedChallenge = await consumeChallenge(userId, kind);
  const stored = await prisma.platformOwnerCredential.findUnique({ where: { credentialId: response.id } });
  if (!stored || stored.userId !== userId || stored.revokedAt) throw new Error("Clé WebAuthn inconnue, révoquée, ou n'appartenant pas à cet utilisateur.");

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: { id: stored.credentialId, publicKey: new Uint8Array(stored.publicKey), counter: Number(stored.counter), transports: stored.transports ? (JSON.parse(stored.transports) as AuthenticatorTransport[]) : undefined },
    requireUserVerification: true,
  });
  if (!verification.verified) throw new Error("Vérification d'authentification WebAuthn échouée.");

  // Anti-clonage FIDO2 : le compteur DOIT strictement augmenter — sinon la
  // clé (ou un clone) est immédiatement révoquée, jamais une authentification acceptée malgré l'anomalie.
  const newCounter = verification.authenticationInfo.newCounter;
  if (newCounter <= Number(stored.counter) && !(newCounter === 0 && Number(stored.counter) === 0)) {
    await prisma.platformOwnerCredential.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    throw new Error("Anomalie de compteur FIDO2 détectée (clonage possible) — cette clé a été révoquée automatiquement. Enregistrez-en une nouvelle.");
  }
  await prisma.platformOwnerCredential.update({ where: { id: stored.id }, data: { counter: newCounter, lastUsedAt: new Date() } });
  return { credentialId: stored.credentialId };
}
