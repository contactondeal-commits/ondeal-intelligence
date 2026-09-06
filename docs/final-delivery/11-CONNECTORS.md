# 11 — Inventaire exhaustif des connecteurs

Deux registres distincts existent dans le dépôt : les connecteurs **Merchant Plane** (`IntegrationProvider`, boutique par boutique) et les connecteurs **Control Plane** (AI Lab, `src/lib/ai/connectors/registry.ts`).

## Merchant Plane — `IntegrationProvider` (6 valeurs, `prisma/schema.prisma`)

| Connecteur | Fichier | Catégorie | Preuve |
|---|---|---|---|
| SHOPIFY | `src/lib/integrations/shopify.ts` (486 lignes) | **Fully real** | 3 fichiers de test, vérifié en production, sync réel |
| WOOCOMMERCE | `src/lib/integrations/woocommerce.ts` (348 lignes) | **Fully real (code), partiel (vérification)** | 1 fichier de test ; aveu explicite en code : "jamais vérifié contre une vraie boutique WooCommerce" |
| PRESTASHOP | `src/lib/integrations/prestashop.ts` (379 lignes) | **Fully real (code), partiel (vérification)** | 1 fichier de test ; aveu explicite en code : "aucune vérification contre une vraie boutique PrestaShop" |
| CJDROPSHIPPING | `src/lib/integrations/cjdropshipping.ts` (239 lignes) | **Fully real, vérifié en production** | 2 fichiers de test ; incident réel documenté (mauvais header d'auth) + correctif le jour même |
| JUDGEME | `src/lib/integrations/judgeme.ts` (116 lignes) | **Real (code), non testé** | implémentation réelle, zéro test dédié |
| GOOGLE_ANALYTICS | `src/lib/integrations/google-analytics.ts` (283 lignes) | **Real (code), non testé** | OAuth2 réel + JWT anti-CSRF, zéro test dédié |

**Décompte exact : 4 pleinement réels et testés (dont 1 vérifié en incident réel de production) / 2 réels en code mais jamais vérifiés contre un vrai service tiers ni testés / 0 non construit.**

## Control Plane — `src/lib/ai/connectors/registry.ts`

| Connecteur | État | Détail |
|---|---|---|
| GitHub | **Réel, platform-scoped** | PAT Owner, credentials chiffrées AES-256-GCM (`PlatformIntegration`), health check réel, seul connecteur capable d'écrire (ouverture de PR réelle) |
| Klaviyo | **Réel, platform-scoped** | clé API via env var, testé (2 fichiers) |
| Windsor.ai | **Réel, platform-scoped** | testé (2 fichiers) |
| ~22 restants (google_calendar, gmail, google_drive, microsoft_365, notion, superhuman_docs, atlassian, slack, context7, adobe, canva, cloudinary, descript, matrixify, supermetrics, zoho_desk, google_search_console, google_merchant_center, google_ads, meta_ads, tiktok_ads, figma, merchant_postgres, bigquery, s3, browser_agent, et quelques autres au-delà de la plage inspectée — le fichier lui-même les estime à "~28") | **Architecture-only** | codés en dur pour toujours renvoyer `NOT_CONFIGURED`, `version: "0.0.0-architecture-only"` — jamais un statut `CONNECTED` fabriqué. Chacun bloqué sur une décision Owner nommée : enregistrement d'une app OAuth2 ou collage d'une clé API en variable d'environnement Vercel. |

**Décompte exact Control Plane : 3 réels et testés (GitHub, Klaviyo, Windsor.ai) / ~22-28 architecture-only, 0 partiel.**

## Principe de conception vérifié

Le code applique le principe "NO FAKE CONNECTOR" de façon vérifiable — chaque connecteur architecture-only est câblé pour renvoyer un statut honnête plutôt que d'être simplement absent de la liste, ce qui rend le manque visible à l'Owner plutôt que silencieux.

## Action Owner requise pour chaque connecteur architecture-only

Aucune action de code ne peut faire progresser ces ~22-28 connecteurs — chacun nécessite soit une app OAuth2 enregistrée par l'Owner sur la plateforme tierce, soit une clé API collée en variable d'environnement Vercel. Voir 14-POST-PHASE-5-ROADMAP.md (P3) pour la priorisation suggérée.
