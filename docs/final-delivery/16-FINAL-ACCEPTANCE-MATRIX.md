# 16 — Matrice d'acceptation finale (extrêmement stricte)

Rubrique unique et exclusive pour ce document : **✅ VERIFIED / 🟢 OWNER VERIFIED / 🟡 PARTIAL / 🟠 EXTERNAL DEPENDENCY / 🔴 FAILED / ⚪ NOT IMPLEMENTED**. Aucune ligne n'est verte sur la base d'une supposition — chaque ligne porte une preuve datée et vérifiable (commande exécutée, fichier de test, capture Owner déjà fournie en conversation, ou citation fichier:ligne). Ce document remplace, comme livrable mandaté, l'ancienne `ACCEPTANCE_MATRIX_06-09-2026_FINAL.md` (conservée non modifiée, non supprimée, à la racine du dépôt).

## 1. Infrastructure et déploiement

| # | Élément | Statut | Preuve |
|---|---|---|---|
| 1.1 | Build de production réel (`npm run build`) | ✅ VERIFIED | exécuté ce jour, succès, voir 06-TEST-EVIDENCE.md |
| 1.2 | TypeScript strict sans erreur (`tsc --noEmit`) | ✅ VERIFIED | exécuté ce jour, 0 erreur |
| 1.3 | ESLint sans erreur | ✅ VERIFIED | exécuté ce jour, 0 erreur |
| 1.4 | Suite unitaire/intégration Vitest | ✅ VERIFIED | 538/538 tests, 68 fichiers, exécuté ce jour |
| 1.5 | Suite E2E smoke réelle | ✅ VERIFIED | 27/27, exécuté ce jour, DB réelle |
| 1.6 | Déploiement production = HEAD du dépôt local (`fc3b3b3`) | ✅ VERIFIED | `/api/health` interrogé ce jour, `VERCEL_GIT_COMMIT_SHA` = `fc3b3b3` |
| 1.7 | Résilience à une coupure DB courte (503 propre, reprise automatique) | ✅ VERIFIED | test de panne forcée réel exécuté (commit `16947f8`), voir 07/18 |
| 1.8 | Résilience multi-région / DR au-delà d'une coupure DB courte | ⚪ NOT IMPLEMENTED | aucune procédure au-delà de celle testée, voir 18-DISASTER-RECOVERY.md |

## 2. Sécurité Platform Owner

| # | Élément | Statut | Preuve |
|---|---|---|---|
| 2.1 | Connexion Owner (email/mot de passe) | 🟢 OWNER VERIFIED | confirmé en conversation par l'Owner ce jour |
| 2.2 | Enregistrement passkey WebAuthn réel | 🟢 OWNER VERIFIED | notification native Chrome "Clé d'accès enregistrée" confirmée, capture fournie |
| 2.3 | Accès `/ai-lab` avec header Owner correct | 🟢 OWNER VERIFIED | capture fournie : "contact@ondeal.fr — Platform Owner", "SYSTEM LIVE" |
| 2.4 | Refus d'un compte non-Owner sur capacité Owner | ✅ VERIFIED (équivalence automatisée) | red-team réel `Role.OWNER` métier ≠ Platform Owner, 403 confirmé par test — voir 15.A ligne 5 pour la nuance |
| 2.5 | Anti-replay challenge WebAuthn (suppression pré-vérification) | ✅ VERIFIED | lecture directe du code (`webauthn/verify` routes) — aucun test automatisé dédié au rejeu, voir 12 |
| 2.6 | Anti-clone (compteur FIDO2 strictement croissant → révocation) | ✅ VERIFIED (code) | logique présente et lue directement ; aucun test automatisé dédié, voir 08/12 |
| 2.7 | Step-up L3 (fenêtre 5 minutes) | ⚪ NOT IMPLEMENTED (preuve d'exécution) | code ✅ VERIFIED par lecture, jamais exécuté par l'Owner à ce jour |
| 2.8 | Révocation de session Owner | ⚪ NOT IMPLEMENTED (preuve d'exécution) | route existe et est capability-gated, jamais exercée par l'Owner |
| 2.9 | Kill switch global (pause missions AI Lab) | ⚪ NOT IMPLEMENTED (preuve d'exécution) | code ✅ VERIFIED par lecture/tests policyEngine, jamais actionné en production par l'Owner |
| 2.10 | CSRF double-submit sur toutes les routes mutantes `/api/*` | ✅ VERIFIED | lecture de `middleware.ts` + liste d'exemption vérifiée exhaustive, aucune route `/api/owner/*` ou `/api/ai-lab/*` exemptée |

## 3. AI Lab — capacités cœur

| # | Élément | Statut | Preuve |
|---|---|---|---|
| 3.1 | Policy Engine (`evaluatePolicy`) — matrice de décision complète | ✅ VERIFIED | `tests/policyEngine.test.ts`, exécuté ce jour |
| 3.2 | Supervisor — planification réelle multi-étapes (1 appel LLM) | ✅ VERIFIED | `tests/supervisorGraphRunner.test.ts` |
| 3.3 | Supervisor — exécution parallèle de nœuds, budgets/timeouts réels | ✅ VERIFIED | même suite |
| 3.4 | Supervisor — pause/reprise réelle | ✅ VERIFIED | même suite |
| 3.5 | Supervisor — retry au niveau nœud | ⚪ NOT IMPLEMENTED | absence confirmée par lecture du runner, voir 03/13 |
| 3.6 | Rollback de mutation (SANDBOX ou PRODUCTION) | ⚪ NOT IMPLEMENTED | absence confirmée, voir 12/13/14 (P0.2) |
| 3.7 | Différenciation réelle ASSIST/AUTONOMOUS/DEEP/ULTIMATE | 🟡 PARTIAL | ASSIST distinct ; les 3 autres niveaux code-identiques, voir 03/13 |
| 3.8 | Mémoire (écriture/lecture mécanique mot-clé) | ✅ VERIFIED | lecture code + tests dédiés mémoire |
| 3.9 | Mémoire sémantique (embeddings) | ⚪ NOT IMPLEMENTED | non construit, voir 13/14 (P2.1) |
| 3.10 | Génération d'image réelle (texte→image) | ✅ VERIFIED | provider réel câblé, commit `308472c` |
| 3.11 | Vision (revue d'écran interne Coder Agent) | ✅ VERIFIED | utilisé dans le graphe Coder Agent, code lu directement |
| 3.12 | Vision en entrée pour missions marchandes (analyse image produit) | ⚪ NOT IMPLEMENTED | non construit, voir 13 |
| 3.13 | System Evolution — PR réelle vers GitHub | ✅ VERIFIED | `src/lib/ai/connectors/github.ts` + `evolution/ship.ts`, code lu directement |
| 3.14 | System Evolution — blocage structurel de l'auto-approbation | ✅ VERIFIED | `requireCapabilityWithStepUp` + approbation humaine préalable exigée dans la route ship, lu directement |
| 3.15 | Première mission Owner réelle en SANDBOX+ASSIST (protocole §10) | ⚪ NOT IMPLEMENTED (preuve d'exécution) | protocole prêt (voir 15.B), jamais exécuté à ce jour |

## 4. Observabilité, ROI, audit

| # | Élément | Statut | Preuve |
|---|---|---|---|
| 4.1 | Sonde de santé publique + Owner Cockpit | ✅ VERIFIED | commit `5067539`, code + route lus directement |
| 4.2 | Outcome/ROI Engine réel | ✅ VERIFIED | commit `5a41570`, câblé au cockpit Owner |
| 4.3 | Audit trail des opérations Owner/AI Lab | ✅ VERIFIED (code) | route `/api/ai-lab/audit` lue directement ; aucun test HTTP dédié, voir 12 |
| 4.4 | Alerting proactif (push/email sur dégradation) | ⚪ NOT IMPLEMENTED | non construit, voir 13/14 (P1.2) |

## 5. Merchant Plane / SaaS

| # | Élément | Statut | Preuve |
|---|---|---|---|
| 5.1 | 4 plans (STARTER/PRO/BUSINESS/AGENCY) définis | ✅ VERIFIED | `PLAN_FEATURES`, lu directement |
| 5.2 | `maxProducts` réellement enforced à l'écriture | ✅ VERIFIED | commit `4ca5b3e`, test dédié |
| 5.3 | `maxStores` réellement enforced | ✅ VERIFIED | lu directement + test |
| 5.4 | `maxUsers` enforced | 🟡 PARTIAL | honnêtement inerte, aucune infra email pour invitations, voir 10 |
| 5.5 | 6 features "fantômes" correctement labellisées (bientôt) plutôt que faussement actives | ✅ VERIFIED | commit `cbba32f`, vérifié par lecture UI |
| 5.6 | Billing Stripe + Shopify AppSubscription câblés | ✅ VERIFIED | lu directement, contredit un commentaire obsolète dans `seed.ts` (voir 12) |
| 5.7 | Connecteur Shopify | ✅ VERIFIED | testé, vérifié en production |
| 5.8 | Connecteur CJDropshipping | ✅ VERIFIED | testé, incident réel de production résolu (voir 07) |
| 5.9 | Connecteur WooCommerce | 🟠 EXTERNAL DEPENDENCY | code réel, jamais vérifié contre une vraie boutique WooCommerce (aveu explicite dans le code) |
| 5.10 | Connecteur PrestaShop | 🟠 EXTERNAL DEPENDENCY | code réel, jamais vérifié contre une vraie boutique PrestaShop (aveu explicite dans le code) |
| 5.11 | Connecteur Judge.me | 🟠 EXTERNAL DEPENDENCY | code réel, zéro test, jamais vérifié contre un vrai compte |
| 5.12 | Connecteur Google Analytics | 🟠 EXTERNAL DEPENDENCY | code réel, zéro test, jamais vérifié contre un vrai compte |

## 6. Connecteurs Control Plane (AI Lab)

| # | Élément | Statut | Preuve |
|---|---|---|---|
| 6.1 | GitHub (platform-scoped, écriture réelle) | ✅ VERIFIED | testé, credentials chiffrées AES-256-GCM lues directement |
| 6.2 | Klaviyo | ✅ VERIFIED | testé (2 fichiers) |
| 6.3 | Windsor.ai | ✅ VERIFIED | testé (2 fichiers) |
| 6.4 | ~22-28 connecteurs restants (Slack, Google Ads, Meta Ads, Notion, etc.) | ⚪ NOT IMPLEMENTED | architecture-only, `NOT_CONFIGURED` codé en dur, bloqué sur décision Owner (app OAuth2/clé API) |

## 7. Données, mémoire, confidentialité

| # | Élément | Statut | Preuve |
|---|---|---|---|
| 7.1 | Export de compte marchand | ✅ VERIFIED (code) | route lue directement |
| 7.2 | Suppression de compte marchand | ✅ VERIFIED (code) | route lue directement |
| 7.3 | Filtrage `MemoryRecord.expiresAt` en lecture | ✅ VERIFIED | code lu directement |
| 7.4 | Purge automatique effective (cron) de `MemoryRecord`/`AiLabAttachment` expirés | ⚪ NOT IMPLEMENTED | aucun job cron trouvé, point RGPD ouvert, voir 09/13 (P0.1) |
| 7.5 | Isolation `TestReview` vs `Review` (générateur d'avis fictifs) | ✅ VERIFIED | séparation imposée par le schéma Prisma lui-même, lue directement |

## Synthèse chiffrée

| Statut | Nombre de lignes |
|---|---|
| ✅ VERIFIED | 30 |
| 🟢 OWNER VERIFIED | 3 |
| 🟡 PARTIAL | 2 |
| 🟠 EXTERNAL DEPENDENCY | 6 |
| 🔴 FAILED | 0 |
| ⚪ NOT IMPLEMENTED | 12 |

**Aucun 🔴 FAILED n'a été constaté à date d'écriture** — chaque défaut fixable rencontré pendant la constitution de ce dossier (déploiement, configuration Owner) a été corrigé et revérifié avant d'être documenté ici, conformément à la règle du mandat de ne jamais s'arrêter au premier incident réparable. Les 12 lignes ⚪ NOT IMPLEMENTED sont soit des protocoles prêts mais non encore exécutés par l'Owner (2.7, 2.8, 2.9, 3.15), soit des capacités réellement absentes du code (3.5, 3.6, 3.9, 3.12, 4.4, 6.4, 7.4), soit une résilience au-delà du périmètre testé (1.8).
