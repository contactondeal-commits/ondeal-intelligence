import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";

const SESSION_COOKIE = "ondeal_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 jours

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret === "changeme-generate-a-real-secret") {
    throw new Error(
      "AUTH_SECRET manquant ou non configuré. Générez-en un avec `openssl rand -base64 32`.",
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  email: string;
  // Renseigné uniquement pour une session ouverte depuis l'app embarquée
  // (App Bridge) — domaine *.myshopify.com de la boutique. Utilisé par le
  // middleware pour autoriser dynamiquement le framing (CSP frame-ancestors)
  // sur ce domaine précis, jamais plus large. Absent pour une session web
  // classique (login autonome).
  embeddedShop?: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function setSessionCookie(token: string, opts?: { sameSite?: "lax" | "none" }): Promise<void> {
  const sameSite = opts?.sameSite ?? "lax";
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // SameSite=None exige Secure=true (imposé par les navigateurs) — requis
    // pour que le cookie de session soit envoyé depuis l'iframe admin
    // Shopify (contexte tiers). Utilisé uniquement pour les sessions
    // ouvertes via l'app embarquée (voir /api/shopify/session-token-exchange).
    secure: process.env.NODE_ENV === "production" || sameSite === "none",
    sameSite,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") return null;
    return {
      userId: payload.userId,
      email: payload.email,
      embeddedShop: typeof payload.embeddedShop === "string" ? payload.embeddedShop : undefined,
    };
  } catch {
    return null;
  }
}

export interface CurrentUserContext {
  user: { id: string; email: string; name: string };
  memberships: Array<{ organizationId: string; organizationName: string; role: Role }>;
}

export async function getCurrentUser(): Promise<CurrentUserContext | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { memberships: { include: { organization: true } } },
  });
  if (!user) return null;
  return {
    user: { id: user.id, email: user.email, name: user.name },
    memberships: user.memberships.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      role: m.role,
    })),
  };
}

/**
 * Vérifie que l'utilisateur courant a bien accès à `storeId` via une
 * organisation dont il est membre. C'est la SEULE porte d'entrée autorisée
 * pour lire/écrire des données d'une boutique — garantit l'isolation
 * multi-tenant (PHASE 2 / PHASE 18).
 */
export async function requireStoreAccess(storeId: string): Promise<{
  userId: string;
  role: Role;
}> {
  const session = await getSession();
  if (!session) throw new AuthError("Non authentifié.");

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { organizationId: true },
  });
  if (!store) throw new AuthError("Boutique introuvable.");

  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: session.userId, organizationId: store.organizationId } },
  });
  if (!membership) throw new AuthError("Accès refusé à cette boutique.");

  return { userId: session.userId, role: membership.role };
}

export class AuthError extends Error {}

/**
 * Rôles autorisés à MODIFIER l'état d'une boutique (mutation Shopify,
 * intégrations, hypothèses de coût, synchronisation). VIEWER = lecture seule.
 * Vérification serveur explicite (production 04/09/2026) — indépendante du
 * menu rendu côté client.
 */
export const WRITE_ROLES: ReadonlyArray<Role> = ["OWNER", "ADMIN", "ANALYST"];
export const ADMIN_ROLES: ReadonlyArray<Role> = ["OWNER", "ADMIN"];

export function requireRole(role: Role, allowed: ReadonlyArray<Role>): void {
  if (!allowed.includes(role)) throw new AuthError("Votre rôle ne permet pas cette opération.");
}
