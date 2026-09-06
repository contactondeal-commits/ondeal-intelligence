import { cookies, headers } from "next/headers";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { isPlatformOwner } from "@/lib/authz/capabilities";

/**
 * ONDEAL AI CORE — OWNER STRONG AUTHENTICATION, couche session (06/09/2026).
 *
 * SÉPARÉE de la session applicative normale (auth.ts, JWT stateless) —
 * ici, une vraie ligne DB (PlatformOwnerSession) : c'est ce qui rend une
 * révocation RÉELLE possible ("session revocation" du mandat), impossible
 * avec un JWT stateless seul. Cette session ne s'ouvre QUE via une
 * cérémonie WebAuthn réussie (webauthn.ts) — jamais fabriquée ailleurs, et
 * en particulier JAMAIS depuis un chemin de code accessible à une mission
 * Supervisor/spécialiste (§"AI self-promotion impossible" : aucun fichier
 * supervisor/*.ts n'importe ce module en écriture).
 */

const OWNER_SESSION_COOKIE = "ondeal_owner_session";
const STEP_UP_TTL_MS = 5 * 60 * 1000; // §"step-up authentication" : fenêtre courte et réelle, jamais une élévation permanente oubliée

export class OwnerAuthError extends Error {
  constructor(message: string, public readonly code: "NO_SESSION" | "REVOKED" | "NOT_OWNER" | "STEP_UP_REQUIRED" = "NO_SESSION") {
    super(message);
  }
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export async function createOwnerSession(userId: string, credentialId: string): Promise<string> {
  if (!isPlatformOwner(userId)) throw new OwnerAuthError("Cet utilisateur n'est pas dans PLATFORM_OWNER_USER_IDS — une session Owner ne peut pas être créée.", "NOT_OWNER");
  const hdrs = await headers();
  const session = await prisma.platformOwnerSession.create({
    data: {
      userId,
      credentialId,
      assuranceLevel: "L2_PASSKEY",
      userAgent: hdrs.get("user-agent")?.slice(0, 300) ?? null,
      ipHash: hashIp(hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null),
    },
  });
  const store = await cookies();
  store.set(OWNER_SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 jours — plus court que la session applicative (30j) : une identité renforcée doit être réaffirmée plus souvent
  });
  return session.id;
}

export async function clearOwnerSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(OWNER_SESSION_COOKIE);
}

/** Lit la session Owner courante SANS exiger qu'elle soit valide — pour l'UI (afficher "non connecté en Owner" plutôt que planter). */
export async function getOwnerSessionRaw() {
  const store = await cookies();
  const id = store.get(OWNER_SESSION_COOKIE)?.value;
  if (!id) return null;
  return prisma.platformOwnerSession.findUnique({ where: { id } });
}

/**
 * Porte RÉELLE : lève si aucune session Owner valide (absente, révoquée) —
 * appelée par requirePlatformOwnerPage() ET par requireCapabilityWithOwnerSession()
 * (capabilities.ts) pour TOUTE action Control Plane sensible. Rafraîchit
 * lastSeenAt à chaque appel (visibilité "sessions actives" réelle).
 */
export async function requireOwnerSession(userId: string): Promise<{ sessionId: string; assuranceLevel: "L2_PASSKEY" | "L3_STEP_UP" }> {
  const session = await getOwnerSessionRaw();
  if (!session) throw new OwnerAuthError("Aucune session Platform Owner (WebAuthn) active — authentifiez-vous par passkey depuis /owner-auth.", "NO_SESSION");
  if (session.userId !== userId) throw new OwnerAuthError("La session Owner active n'appartient pas à l'utilisateur courant.", "NO_SESSION");
  if (session.revokedAt) throw new OwnerAuthError("Cette session Owner a été révoquée.", "REVOKED");
  await prisma.platformOwnerSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  const level = session.assuranceLevel === "L3_STEP_UP" && session.stepUpExpiresAt && session.stepUpExpiresAt.getTime() > Date.now() ? "L3_STEP_UP" : "L2_PASSKEY";
  return { sessionId: session.id, assuranceLevel: level };
}

/**
 * §"step-up authentication" + "sensitive-action gates" : exige une
 * élévation RÉCENTE (< 5 min) de la session courante — jamais seulement
 * "l'utilisateur a une session Owner". Kill switch, Policy, connecteurs,
 * force model, dispatch GitHub passent TOUS par cette fonction avant
 * d'exécuter l'effet réel (jamais après).
 */
export async function requireStepUp(userId: string): Promise<{ sessionId: string }> {
  const { sessionId, assuranceLevel } = await requireOwnerSession(userId);
  if (assuranceLevel !== "L3_STEP_UP") throw new OwnerAuthError("Action sensible : ré-authentification (step-up WebAuthn) requise — valide 5 minutes.", "STEP_UP_REQUIRED");
  return { sessionId };
}

export async function elevateToStepUp(sessionId: string): Promise<void> {
  await prisma.platformOwnerSession.update({
    where: { id: sessionId },
    data: { assuranceLevel: "L3_STEP_UP", stepUpExpiresAt: new Date(Date.now() + STEP_UP_TTL_MS) },
  });
}

export async function listOwnerSessions(userId: string) {
  const store = await cookies();
  const currentId = store.get(OWNER_SESSION_COOKIE)?.value ?? null;
  const sessions = await prisma.platformOwnerSession.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, take: 50 });
  return sessions.map((s) => ({
    id: s.id,
    isCurrent: s.id === currentId,
    assuranceLevel: s.stepUpExpiresAt && s.stepUpExpiresAt.getTime() > Date.now() ? "L3_STEP_UP" : "L2_PASSKEY",
    userAgent: s.userAgent,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    revokedAt: s.revokedAt,
    revokedReason: s.revokedReason,
  }));
}

/** Révocation RÉELLE (§"session revocation") : `revokedAt` non-null, vérifié à CHAQUE requireOwnerSession suivant — jamais un TTL qui expire seul. */
export async function revokeOwnerSession(userId: string, sessionId: string, reason: string): Promise<boolean> {
  const result = await prisma.platformOwnerSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count > 0;
}

/** §"Kill Switch Owner" élargi : révoque TOUTES les sessions Owner de cet utilisateur d'un coup (ex. suspicion de compromission). */
export async function revokeAllOwnerSessions(userId: string, reason: string): Promise<number> {
  const result = await prisma.platformOwnerSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  return result.count;
}
