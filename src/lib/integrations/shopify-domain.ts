// Normalisation/validation stricte d'un domaine *.myshopify.com — partagée
// entre la connexion manuelle (Paramètres > Intégrations) et le flux OAuth
// (commercialisation). Anti-SSRF : l'app n'effectue jamais de requête
// sortante vers un hôte arbitraire fourni par un utilisateur.
const MYSHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/i;

export function normalizeMyshopifyDomain(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  return MYSHOPIFY_DOMAIN.test(host) ? host : null;
}
