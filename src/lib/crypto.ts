import crypto from "node:crypto";

// Chiffrement AES-256-GCM des identifiants d'intégration (Shopify/Judge.me)
// avant stockage en base. La clé provient exclusivement de la variable
// d'environnement serveur CREDENTIALS_ENCRYPTION_KEY — jamais côté client,
// jamais en dur dans le code (voir PHASE 18 — Sécurité).
function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw || raw === "changeme-generate-a-real-32-byte-key") {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY manquant ou non configuré. Générez une clé avec " +
        "`openssl rand -base64 32` et définissez-la dans votre environnement avant de " +
        "connecter une intégration.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY doit décoder en exactement 32 octets (base64).");
  }
  return key;
}

export function encryptJson(value: unknown): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptJson<T = unknown>(payload: string): T {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Format de credentials chiffrés invalide.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}
