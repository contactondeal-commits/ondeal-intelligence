# 05 — Capability Matrix exhaustive

Légende : Oui / Non / Partiel. "Owner tested" = exécuté réellement par l'Owner en session authentifiée (pas seulement par un agent). Preuve = fichier, test ou résultat vérifiable.

| Capability | Code exists | Unit tested | Integration tested | E2E tested | Production tested | Owner tested | External dep. | Autonomous | Prod write | Safety control | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Session applicative (JWT) | Oui | Oui | Oui | Oui | Oui | Oui | Non | Non | — | CSRF+httpOnly | ✅ VERIFIED | `src/lib/auth.ts`, merchant-e2e 14/14 |
| CSRF double-submit | Oui | Oui | Oui | Oui | — | — | Non | Non | — | middleware | ✅ VERIFIED | `src/middleware.ts`, red-team |
| Isolation Merchant Plane (storeId) | Oui | Oui | Oui | Oui | Oui | Non | Non | Non | Oui | requireStoreAccess | ✅ VERIFIED | red-team IDOR 403 |
| PlanLimit.maxProducts | Oui | Oui | Non | Non | Non | Non | Non | Non | Oui | quota au write | ✅ VERIFIED | `tests/planLimitEnforcement.test.ts` (4) |
| PlanLimit.maxStores | Oui | Oui | Non | Non | Non | Non | Non | Non | Oui | canCreateStore | ✅ VERIFIED | `src/lib/plan-limits.ts` |
| PLAN_FEATURES intégrité | Oui | Oui | Non | Non | Non | Non | Non | Non | — | scan source réel | ✅ VERIFIED | `tests/planFeatureIntegrity.test.ts` (3) |
| Billing Stripe | Oui | Non trouvé | Non | Non | Non | Non | Oui (Stripe) | Non | Oui (plan) | signature webhook | 🟡 PARTIAL | `src/app/api/webhooks/stripe/route.ts` |
| Billing Shopify AppSubscription | Oui | Non trouvé | Non | Non | Non | Non | Oui (Shopify) | Non | Oui (plan) | HMAC webhook | 🟡 PARTIAL | `src/app/api/webhooks/shopify/app-subscription-update/route.ts` |
| Connecteur Shopify | Oui | Oui | Oui | Oui | Oui | Non | Oui | Non | Oui | requireStoreAccess | ✅ VERIFIED | 3 fichiers de test |
| Connecteur WooCommerce | Oui | Oui | Non (jamais contre boutique réelle) | Non | Non | Non | Oui | Non | Oui | requireStoreAccess | 🟡 PARTIAL | `tests/woocommerce.test.ts`, aveu code |
| Connecteur PrestaShop | Oui | Oui | Non (jamais contre boutique réelle) | Non | Non | Non | Oui | Non | Oui | requireStoreAccess | 🟡 PARTIAL | `tests/prestashop.test.ts`, aveu code |
| Connecteur CJ Dropshipping | Oui | Oui | Oui | Non | Oui (incident+fix réel) | Non | Oui | Non | Non (lecture) | requireStoreAccess | ✅ VERIFIED | 2 fichiers de test + incident documenté |
| Connecteur Judge.me | Oui | Non trouvé | Non | Non | Non | Non | Oui | Non | Non | requireStoreAccess | 🟡 PARTIAL | `src/lib/integrations/judgeme.ts`, zéro test dédié |
| Connecteur Google Analytics 4 | Oui | Non trouvé | Non | Non | Non | Non | Oui (OAuth) | Non | Non | requireStoreAccess | 🟡 PARTIAL | `src/lib/integrations/google-analytics.ts`, zéro test dédié |
| Owner allowlist (isPlatformOwner) | Oui | Oui | Oui | Oui | Oui | Oui | Non | Non | — | env var | ✅ VERIFIED | `capabilities.test.ts`, whoami prod |
| Owner WebAuthn register/login | Oui | Non trouvé (route) | Non | Non | Oui | Oui | Non (navigateur) | Non | — | anti-replay compteur | 🟢 OWNER VERIFIED | passkey enregistrée réellement 06/09/2026 |
| Owner session/step-up | Oui | Non trouvé (route) | Non | Non | Non | Partiel | Non | Non | — | fenêtre 5 min | 🟡 PARTIAL | `src/lib/authz/ownerSession.ts`, pas encore testé par Owner |
| Recovery codes | Oui | Non trouvé | Non | Non | Non | Non | Non | Non | — | hash+usage unique | 🟡 PARTIAL | `src/lib/authz/recovery.ts` |
| Policy Engine (evaluatePolicy) | Oui | Oui | Non | Non | Non | Non | Non | — | — | matrice DENY/ALLOW/APPROVAL | ✅ VERIFIED | `tests/policyEngine.test.ts` |
| Kill switch global | Oui | Oui (via policy) | Non | Non | Non | Non | Non | — | Non (pause) | step-up | 🟡 PARTIAL | jamais déclenché réellement en production |
| Annulation par mission | Oui | Non trouvé | Non | Non | Non | Non | Non | — | Non | requireCapability | 🟡 PARTIAL | `src/app/api/ai-lab/missions/[id]/cancel` |
| Supervisor / Missions | Oui | Oui | Non | Non | Non | Non | Oui (LLM) | Oui | Selon environnement | Policy Engine | ✅ VERIFIED | `supervisorGraphRunner.test.ts` |
| Tool Registry | Oui | Non trouvé | Non | Non | Non | Non | Variable | Non | Selon outil | requireCapability | 🟡 PARTIAL | `src/lib/ai/tools/registry.ts` |
| Connector Registry (Control Plane) | Oui | Oui (registry) | Non | Non | Non | Non | Variable | Non | Non | requireCapability/step-up | 🟡 PARTIAL | tests registry, pas de test route |
| Model Router / Failover | Oui | Oui | Non | Non | Non | Non | Oui (Anthropic/OpenAI) | Non | — | requireCapability | ✅ VERIFIED | 5 fichiers de test |
| Agent Registry | Oui | Non trouvé (route) | Non | Non | Non | Non | Non | Non | — | owner session/step-up | 🟡 PARTIAL | indirect via evolutionProposals.test.ts |
| Memory (lecture/écriture) | Oui | Non trouvé | Non | Non | Non | Non | Non | Oui (auto-écrite) | Non | owner session | 🟡 PARTIAL | pas de test dédié |
| Experiments | Oui | Oui | Non | Non | Non | Non | Oui (LLM) | Non | Non | owner session | ✅ VERIFIED | `experimentRun.test.ts` |
| Evolution (détection→PR) | Oui | Oui | Non | Non | Non | Non | Oui (GitHub) | Oui (jusqu'à approbation) | Oui (PR réelle) | step-up + approbation humaine | ✅ VERIFIED | `evolutionProposals.test.ts`, `evolutionShip.test.ts` |
| Images (génération) | Oui | Oui | Non | Non | Non | Non | Oui (OpenAI) | Non | Non | owner session | ✅ VERIFIED | `imagesRoute.test.ts`, `imageGeneration.test.ts` |
| Outcomes/ROI Engine | Oui | Oui | Non | Non | Non | Non | Non | Non | — | owner session | ✅ VERIFIED | `outcomeEngine.test.ts`, `outcomesRoute.test.ts` |
| Observability | Oui | Oui | Non | Non | Non | Non | Non | Non | — | owner session | ✅ VERIFIED | `observabilityEngine.test.ts`, prod curl |
| Audit trail | Oui | Non trouvé (route) | Non | Non | Non | Partiel (à vérifier §15) | Non | Auto-écrit | — | requireCapability | 🟡 PARTIAL | pas de test dédié |
| `/api/health` | Oui | Oui | Non | Oui | Oui | Non | Non | Non | — | public | ✅ VERIFIED | `tests/health.test.ts`, forced-failure 6/6 |
| Résilience panne DB | Oui | — | — | Oui (réelle) | — | Non | Non | Auto | — | dégradation gracieuse | ✅ VERIFIED | forced-failure 6/6, panne réellement provoquée |
| Rate limiting brute-force | Oui | Non trouvé | Non | Oui (réel) | Non | Non | Optionnel (Upstash) | Non | — | 429 | ✅ VERIFIED | red-team (12 tentatives → 429) |
| Account delete/export | Oui | Non trouvé | Non | Non | Non | Non | Non | Non | Oui (delete) | confirmation + password | 🟡 PARTIAL | lu intégralement, jamais testé automatiquement |
| Rollback / undo mutation marchande | Non | — | — | — | — | — | — | — | — | — | ⚪ NOT IMPLEMENTED | grep exhaustif, zéro résultat |
| Rétention/suppression auto données AI Lab | Non | — | — | — | — | — | — | — | — | — | ⚪ NOT IMPLEMENTED | aucun cron, `expiresAt` filtré non purgé |
| Niveaux d'autonomie différenciés (AUTONOMOUS/DEEP/ULTIMATE) | Non (code identique) | — | — | — | — | — | — | — | — | — | ⚪ NOT IMPLEMENTED | une seule branche ASSIST-only dans le code |
| Team invites (Merchant Plane) | Non | — | — | — | — | — | — | — | — | — | ⚪ NOT IMPLEMENTED | aucune infra email dans le dépôt |
| Suppliers / Reports / Agency Workspace | Non | — | — | — | — | — | — | — | — | — | ⚪ NOT IMPLEMENTED | pas de route/page, marqué "(bientôt)" en UI |
| API publique marchande | Non | — | — | — | — | — | — | — | — | — | ⚪ NOT IMPLEMENTED | aucune conception |
| ~22 connecteurs architecture-only | Non | — | — | — | — | — | Oui (à configurer) | — | — | `NOT_CONFIGURED` forcé | ⚪ NOT IMPLEMENTED / 🟠 EXTERNAL DEPENDENCY | `registry.ts` |

Pour l'inventaire connecteur détaillé et exhaustif, voir 11-CONNECTORS.md. Pour la matrice finale consolidée (avec preuve par ligne, rubric strict du mandat), voir 16-FINAL-ACCEPTANCE-MATRIX.md.
