import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — FINAL PHASE : auto-diagnostic Owner (06/09/2026).
 *
 * Verrouille GET /api/owner/whoami :
 *   - 401 (jamais un identifiant renvoyé) si aucune session applicative valide.
 *   - Chemin heureux : renvoie EXACTEMENT l'identité de l'appelant courant
 *     (jamais celle d'un autre utilisateur) et le résultat réel de
 *     isPlatformOwner — y compris `false`, cas central de cette route
 *     (diagnostiquer POURQUOI l'allowlist ne reconnaît pas l'appelant).
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadRoute(opts: { currentUser?: { id: string; email: string } | null; isPlatformOwner?: boolean }) {
  vi.resetModules();
  vi.doMock("@/lib/auth", () => ({
    getCurrentUser: vi.fn().mockResolvedValue(opts.currentUser === undefined ? null : opts.currentUser ? { user: opts.currentUser } : null),
  }));
  const isPlatformOwner = vi.fn().mockReturnValue(opts.isPlatformOwner ?? false);
  vi.doMock("@/lib/authz/capabilities", () => ({ isPlatformOwner }));
  const mod = await import("@/app/api/owner/whoami/route");
  return { ...mod, isPlatformOwner };
}

describe("GET /api/owner/whoami", () => {
  it("répond 401 (jamais un identifiant renvoyé) sans session applicative valide", async () => {
    const { GET } = await loadRoute({ currentUser: null });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Non authentifié." });
  });

  it("renvoie l'identité RÉELLE de l'appelant courant et isPlatformOwner=false quand l'allowlist ne le reconnaît pas (cas central du diagnostic)", async () => {
    const { GET, isPlatformOwner } = await loadRoute({ currentUser: { id: "user-42", email: "owner@ondeal.fr" }, isPlatformOwner: false });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-42", email: "owner@ondeal.fr", isPlatformOwner: false });
    expect(isPlatformOwner).toHaveBeenCalledWith("user-42");
  });

  it("renvoie isPlatformOwner=true quand l'allowlist reconnaît l'appelant", async () => {
    const { GET } = await loadRoute({ currentUser: { id: "owner-1", email: "o@x.com" }, isPlatformOwner: true });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "owner-1", email: "o@x.com", isPlatformOwner: true });
  });
});
