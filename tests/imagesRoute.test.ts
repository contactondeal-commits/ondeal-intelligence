import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * ONDEAL AI CORE — §41/§202 "provider de génération d'image" (06/09/2026),
 * clôture réelle.
 *
 * Verrouille POST /api/ai-lab/images :
 *   - 403 si la capacité Control Plane / session Owner est refusée — jamais
 *     un appel réel au provider sans vérification.
 *   - 400 sur un corps invalide, jamais un appel provider avec un prompt vide.
 *   - Chemin heureux : image réelle retournée au client + audit RÉUSSITE
 *     journalisé (toolId="create_image", coût réel).
 *   - Échec provider (ex. clé absente) : 400 + audit ÉCHEC journalisé —
 *     jamais un succès simulé quand le provider a réellement échoué.
 */

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ai-lab/images", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadRoute(opts: {
  /** Si posé, requireCapabilityWithOwnerSession rejette avec une CapabilityError DE LA MÊME CLASSE que celle exportée par ce mock (jamais deux classes distinctes issues de deux vi.doMock séparés — voir tests/missionStreamRoute.test.ts pour le même écueil déjà rencontré). */
  ownerSessionRejection?: string;
  generateImage?: ReturnType<typeof vi.fn>;
  appendAuditLog?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  vi.doMock("@/lib/authz/capabilities", () => {
    class CapabilityError extends Error {}
    const requireCapabilityWithOwnerSession = opts.ownerSessionRejection
      ? vi.fn().mockRejectedValue(new CapabilityError(opts.ownerSessionRejection))
      : vi.fn().mockResolvedValue({ userId: "owner1", email: "o@x.com" });
    return { requireCapabilityWithOwnerSession, CapabilityError };
  });
  vi.doMock("@/lib/authz/ownerSession", () => ({ OwnerAuthError: class OwnerAuthError extends Error {} }));
  const generateImage = opts.generateImage ?? vi.fn().mockResolvedValue({ imageBase64: "ZmFrZQ==", mediaType: "image/png", provider: "openai", model: "dall-e-3", revisedPrompt: null, costUsd: 0.04 });
  vi.doMock("@/lib/ai/providers/imageGeneration", () => ({ resolveDefaultImageProvider: vi.fn(() => ({ generateImage })) }));
  const appendAuditLog = opts.appendAuditLog ?? vi.fn().mockResolvedValue(undefined);
  vi.doMock("@/lib/ai/policy/audit", () => ({ appendAuditLog }));
  const mod = await import("@/app/api/ai-lab/images/route");
  return { ...mod, generateImage, appendAuditLog };
}

describe("POST /api/ai-lab/images", () => {
  it("répond 403 (jamais d'appel provider) quand la capacité/session Owner est refusée", async () => {
    const { POST, generateImage } = await loadRoute({ ownerSessionRejection: "Session Owner requise." });

    const res = await POST(makeRequest({ prompt: "un logo" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Session Owner requise.");
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("répond 400 sur un corps invalide (prompt vide), jamais d'appel provider", async () => {
    const { POST, generateImage } = await loadRoute({});
    const res = await POST(makeRequest({ prompt: "" }));
    expect(res.status).toBe(400);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("chemin heureux : retourne l'image réelle et journalise un audit SUCCESS avec le coût réel", async () => {
    const generateImage = vi.fn().mockResolvedValue({ imageBase64: "ZmFrZS1wbmc=", mediaType: "image/png", provider: "openai", model: "dall-e-3", revisedPrompt: "prompt révisé", costUsd: 0.08 });
    const appendAuditLog = vi.fn().mockResolvedValue(undefined);
    const { POST } = await loadRoute({ generateImage, appendAuditLog });

    const res = await POST(makeRequest({ prompt: "un t-shirt", size: "1024x1792", quality: "hd" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ imageBase64: "ZmFrZS1wbmc=", mediaType: "image/png", provider: "openai", model: "dall-e-3", revisedPrompt: "prompt révisé", costUsd: 0.08 });

    expect(generateImage).toHaveBeenCalledWith({ prompt: "un t-shirt", size: "1024x1792", quality: "hd" });
    expect(appendAuditLog).toHaveBeenCalledTimes(1);
    const auditArg = appendAuditLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(auditArg.toolId).toBe("create_image");
    expect(auditArg.costUsd).toBe(0.08);
    expect(auditArg.resultStatus).toBe("SUCCESS");
    expect(auditArg.actorUserId).toBe("owner1");
  });

  it("échec provider (ex. clé absente) : 400 + audit FAILURE journalisé, jamais un succès simulé", async () => {
    const generateImage = vi.fn().mockRejectedValue(new Error("OPENAI_API_KEY absent — provider de génération d'image non configuré."));
    const appendAuditLog = vi.fn().mockResolvedValue(undefined);
    const { POST } = await loadRoute({ generateImage, appendAuditLog });

    const res = await POST(makeRequest({ prompt: "un t-shirt" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("OPENAI_API_KEY absent");
    expect(appendAuditLog).toHaveBeenCalledTimes(1);
    const auditArg = appendAuditLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(auditArg.resultStatus).toBe("FAILURE");
  });
});
