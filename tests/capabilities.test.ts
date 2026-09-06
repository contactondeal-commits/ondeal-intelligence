import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONDEAL AI CORE — Control Plane / Merchant Plane, fondation (06/09/2026).
 *
 * Verrouille la règle centrale de la commande "OWNER CONTROL PLANE" :
 * un rôle métier (Membership.role, y compris Role.OWNER d'une
 * organisation cliente) N'ACCORDE JAMAIS de capacité Control Plane. Seule
 * une identité utilisateur figurant explicitement dans
 * PLATFORM_OWNER_USER_IDS le peut. "STORE ADMIN ≠ ONDEAL OWNER".
 */

const ORIGINAL_ENV = process.env.PLATFORM_OWNER_USER_IDS;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (ORIGINAL_ENV === undefined) delete process.env.PLATFORM_OWNER_USER_IDS;
  else process.env.PLATFORM_OWNER_USER_IDS = ORIGINAL_ENV;
});

async function loadCapabilities(opts: { currentUser?: { user: { id: string; email: string; name: string }; memberships: unknown[] } | null }) {
  vi.resetModules();
  vi.doMock("@/lib/auth", () => ({
    getCurrentUser: vi.fn().mockResolvedValue(opts.currentUser ?? null),
  }));
  return import("@/lib/authz/capabilities");
}

describe("requireCapability — frontière Control Plane / Merchant Plane", () => {
  it("refuse un utilisateur non authentifié", async () => {
    const { requireCapability, CapabilityError } = await loadCapabilities({ currentUser: null });
    await expect(requireCapability("AI_MODEL_ADMIN")).rejects.toBeInstanceOf(CapabilityError);
  });

  it("refuse un utilisateur authentifié mais ABSENT de PLATFORM_OWNER_USER_IDS, même avec un rôle OWNER métier réel", async () => {
    process.env.PLATFORM_OWNER_USER_IDS = "cl_real_platform_owner";
    const merchantOwner = {
      user: { id: "cl_merchant_owner", email: "owner@merchant.example", name: "Marchand" },
      // Un vrai Role.OWNER d'organisation cliente — n'a AUCUNE incidence ici.
      memberships: [{ organizationId: "org1", organizationName: "Boutique X", role: "OWNER" }],
    };
    const { requireCapability, CapabilityError } = await loadCapabilities({ currentUser: merchantOwner });
    await expect(requireCapability("AI_MODEL_ADMIN")).rejects.toBeInstanceOf(CapabilityError);
  });

  it("accorde la capacité UNIQUEMENT à l'identifiant listé dans PLATFORM_OWNER_USER_IDS", async () => {
    process.env.PLATFORM_OWNER_USER_IDS = "cl_other,cl_real_platform_owner";
    const platformOwner = {
      user: { id: "cl_real_platform_owner", email: "gold@ondeal.example", name: "Gold" },
      memberships: [],
    };
    const { requireCapability, isPlatformOwner } = await loadCapabilities({ currentUser: platformOwner });
    const result = await requireCapability("AI_MODEL_ADMIN");
    expect(result.userId).toBe("cl_real_platform_owner");
    expect(isPlatformOwner("cl_real_platform_owner")).toBe(true);
    expect(isPlatformOwner("cl_merchant_owner")).toBe(false);
  });

  it("refoule vers un ensemble vide (repli sûr) quand PLATFORM_OWNER_USER_IDS est absent/vide — jamais un accès par défaut", async () => {
    delete process.env.PLATFORM_OWNER_USER_IDS;
    const anyone = { user: { id: "cl_anyone", email: "a@b.example", name: "N" }, memberships: [] };
    const { requireCapability, CapabilityError } = await loadCapabilities({ currentUser: anyone });
    await expect(requireCapability("AI_EVAL_READ")).rejects.toBeInstanceOf(CapabilityError);
  });
});
