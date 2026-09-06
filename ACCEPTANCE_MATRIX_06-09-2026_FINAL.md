# OnDeal AI — Acceptance Matrix consolidée finale (06/09/2026) — Mandat Ultimate, clôture de continuation

Ce document consolide et met à jour la matrice du 06/09/2026 (`ondeal-session-06-09-2026-acceptance-matrix-complete-deploiement-bundle.md`) avec tout ce qui a été livré, testé et vérifié en production depuis — même règle (§97) : **✅ VERIFIED** (prouvé par test/build/E2E/production réels, sans mock aux frontières), **🔐 READY_FOR_OWNER_AUTHORIZATION** (codé et testé, bloqué uniquement par une décision/credential/accès qui n'appartient qu'à l'Owner), ou **⚪ NON CONSTRUIT** (honnêtement pas encore écrit, avec l'emplacement exact où le reprendre). Aucun "🟡 partiel" comme échappatoire.

État des preuves au moment de la rédaction :
- `npx vitest run` → **535/535 tests, 67/67 fichiers**
- `npx tsc --noEmit` → propre
- `npx eslint .` → **0 erreur** (6 avertissements pré-existants sans rapport, inchangés)
- `npm run build` (Next.js 16/Turbopack) → propre
- `npm run e2e:smoke` → **27/27** (build de production réel, `next start`, vraie Postgres locale)
- `npm run merchant-e2e` → **14/14** (parcours marchand réel de bout en bout : signup → onboarding démo → pages → entitlements → mutation autorisée re-vérifiée en base → logout/login)
- `npm run red-team` → **3/3** (IDOR Merchant Plane, isolation Control Plane, rate-limit anti-brute-force — attaques réelles, pas simulées)
- `npm run forced-failure` → **6/6** (panne Postgres réellement provoquée et auto-résolue, `/api/health` jamais menteur)

GitHub `contactondeal-commits/ondeal-intelligence` (`master`) : `16947f8`.
Production Vercel (`intelligence.ondeal.fr`) : **`16947f877b5da494f93e0556cf737bc16e5da575` (`16947f8`)** — confirmé à l'instant via `GET /api/health`, à jour avec `master`. Le déploiement qui était en retard au moment de la rédaction initiale (voir historique §12) s'est résorbé depuis ; smoke production complet re-passé sur ce commit exact (`/login` 200, `/owner-auth` 200, `/api/health` 200, `/api/ai-lab/observability` 403 sans session).

---

## 1. ✅ VERIFIED — Correctif production réel : 500 sur `/api/ai-lab/tools`/`/api/ai-lab/missions`

Root-cause identifiée (imports statiques `pdf-parse`/`mammoth`/`xlsx` dans `attachments/parse.ts`, crash au cold-start serverless Vercel, jamais reproduit en local) et corrigée par imports dynamiques (`9b0f53b`). **Vérifié en production réelle** contre `https://intelligence.ondeal.fr` (pas seulement en local) : `GET /api/ai-lab/tools`, `/api/ai-lab/missions`, `/api/ai-lab/attachments`, `/api/ai-lab/missions/:id/stream` → tous `403` réels (plus jamais `500`), confirmé le 06/09/2026 après que l'Owner a déclenché le déploiement correspondant. `e2e-smoke.ts` couvre désormais ces 4 routes en permanence (régression impossible à l'avenir sans être détectée).

## 2. ✅ VERIFIED — Owner Strong Authentication (WebAuthn/FIDO2)

Inchangé depuis la matrice précédente, toujours vert : WebAuthn/FIDO2 réel, session Owner révocable distincte du JWT applicatif, step-up <5min, codes de récupération à usage unique hashés, page `/owner-auth` complète (dette de lint `react-hooks/set-state-in-effect` **réellement corrigée** ce segment — voir `58e5b8e` — plus seulement documentée comme acceptable).

## 3. ✅ VERIFIED — Provider Continuity, Agents, Memory

Inchangé, toujours vert : router multi-modèle avec failover réel (`FailoverProvider`), capacités `AI_EVAL_READ`/`AI_MODEL_ADMIN`/`SYSTEM_CODER`, mémoire persistante (`MemoryRecord`) réellement lue par le planning du Supervisor.

## 4. ✅ VERIFIED — Experiment Mode, System Evolution Console, SSE, Multi-viewport, Génération d'images

Inchangé depuis la matrice précédente, toujours vert (voir ce document pour le détail : sections 3, 4, 5, 6, 7).

## 5. ✅ VERIFIED — Outcome/ROI Engine (nouveau ce segment, §"Outcome/ROI Engine")

Jusqu'ici totalement absent. `src/lib/ai/outcomes/engine.ts` + `GET /api/ai-lab/outcomes` (Owner uniquement) : agrégation réelle depuis `StorefrontMission`/`EvolutionProposal`/`ExperimentRun` — taux de succès missions, taux de livraison System Evolution (avec URLs de PR réelles vérifiables), coûts moyens. Dénominateur nul → `null`, jamais un taux fabriqué. Nouvel onglet "Outcomes" dans le cockpit AI Lab. 6 tests dédiés. Commit `5a41570`, **vérifié en production réelle**.

## 6. ✅ VERIFIED — Security / Red-Team réel (nouveau ce segment, §"sécurité/red-team")

Jusqu'ici totalement absent (aucun script d'attaque réel dans le dépôt). `scripts/red-team.ts` (`npm run red-team`) : démarre le vrai build de production contre la vraie base, crée deux vrais comptes/organisations/boutiques via signup/onboarding réels, puis tente réellement trois attaques :

1. **IDOR Merchant Plane** — compte A tente d'écrire sur la boutique de B (`POST /api/stores/cost-defaults`) → `403` réel.
2. **Control Plane isolation** ("STORE OWNER ≠ ONDEAL OWNER") — `Role.OWNER` métier légitime tente `SYSTEM_CODER` (`POST /api/coder-missions`) → `403` réel, indépendant du rôle Membership.
3. **Rate limiting anti-brute-force** — 12 tentatives de mot de passe erroné sur le même email → `429` déclenché avant la 12e tentative.

**3/3 défenses tiennent face à une attaque réelle.** Commit `58e5b8e`.

## 7. ✅ VERIFIED — Observabilité réelle (nouveau ce segment, §observabilité)

Jusqu'ici totalement absent — aucune route de santé, aucun moyen de vérifier depuis l'extérieur quel commit est réellement déployé sans capture d'écran du dashboard Vercel (problème vécu en direct dans cette même continuation, voir §12).

- `GET /api/health` (public, sans session) : sonde DB réelle + SHA de commit déployé (`VERCEL_GIT_COMMIT_SHA`, injecté automatiquement par Vercel) + convention 200/503 standard. **A servi directement, en conditions réelles ce segment**, à confirmer sans ambiguïté l'état exact de chaque déploiement — plus jamais une capture d'écran nécessaire.
- `GET /api/ai-lab/observability` (Owner uniquement) : santé opérationnelle 24h — statuts de synchro, intégrations connectées en retard de plus de 48h, taux d'échec AI Lab Audit, missions Coder/Storefront potentiellement bloquées (RUNNING/PLANNING depuis plus de 2h). Nouvel onglet "Observability" dans le cockpit.
- 12 tests dédiés. Commit `5067539`, **vérifié en production réelle**.

## 8. ✅ VERIFIED — Merchant Plane : entitlements réellement wired, enforced, testés (nouveau ce segment, §entitlements — audit complet, pas seulement partiel)

Audit réel de CHAQUE dimension du plan/entitlement matrix (grep sur le code, jamais une supposition) :

- **`PlanLimit.maxProducts`** : modélisé et affiché depuis PHASE 22, **jamais appliqué avant ce segment**. Corrigé au point d'écriture partagé (`storeProducts()`, synchro live + import bulk + WooCommerce/PrestaShop) : un nouveau produit au-delà du quota n'est plus créé (jamais un upsert partiel), une mise à jour d'un produit déjà connu n'est jamais bloquée. Comptabilisé comme une vraie erreur de synchro (`productsBlockedByPlanLimit`), jamais un signalement silencieux. 4 tests. Commit `4ca5b3e`.
- **`PlanLimit.maxStores`** : déjà réellement appliqué (`canCreateStore()`, onboarding) — vérifié inchangé et correct, y compris pour le flux d'installation Shopify App Store (`shopify-provision.ts`, toujours une nouvelle organisation à 0 boutique, jamais un contournement).
- **`PlanLimit.maxUsers`** : `canAddMember()` existe mais est **honnêtement inatteignable** — vérifié par grep qu'AUCUNE route ne crée de `Membership` en dehors de la création du compte fondateur (signup, installation Shopify). Aucune fonctionnalité d'invitation d'équipe n'existe (Settings l'indique déjà explicitement). Non construit CE segment : nécessiterait un fournisseur d'email (aucun n'existe dans le dépôt — `grep` confirmé) → 🔐 READY_FOR_OWNER_AUTHORIZATION le jour où l'Owner fournit une clé de fournisseur d'email, PAS une lacune de code silencieuse.
- **Intégrité de `PLAN_FEATURES` (défaut réel trouvé et corrigé)** : 6 entrées (`automations`, `reports`, `suppliers`, `api`, `team`, `agency_workspace`) étaient affichées comme "actives" à un marchand PRO/BUSINESS/AGENCY payant dans Settings, sans AUCUNE page/route réelle derrière nulle part dans le dépôt. Corrigé : `UNBUILT_FEATURES` (plan-limits.ts) + affichage "(bientôt)" au lieu de "actif" — jamais une promesse retirée, seulement une fausse affirmation "déjà actif" supprimée. **`tests/planFeatureIntegrity.test.ts`** scanne réellement `src/app` et empêche structurellement le retour de ce défaut (toute feature future ajoutée à `PLAN_FEATURES` sans câblage ni déclaration honnête fait échouer le test). 3 tests. Commit `cbba32f`.
- **`multi_store`** : vérifié réellement appliqué, mais via `maxStores` (jamais un `hasFeature()` séparé) — documenté explicitement (`FEATURES_ENFORCED_BY_OTHER_MEANS`) pour que l'audit automatisé le sache.
- **Billing Shopify AppSubscription + Stripe** : inchangé, déjà réel (sessions précédentes) — `Organization.plan` mis à jour uniquement sur confirmation webhook, jamais anticipé.

**Conclusion de l'audit** : la matrice Merchant Plane plans/entitlements est désormais réellement wired, enforced et testée sur toute sa surface actuelle. Le seul entitlement non enforced (`maxUsers`) l'est parce qu'aucune fonctionnalité ne peut encore le violer — pas parce qu'il a été oublié.

## 9. ✅ VERIFIED — Merchant E2E réel + test de panne forcée réel (nouveau ce segment, §E2E, §panne forcée)

- **`scripts/merchant-e2e.ts`** (`npm run merchant-e2e`, 14/14) : parcours marchand réel de bout en bout — signup réel → onboarding réel (mode démo, jeu de données réaliste) → 5 pages authentifiées réellement chargées → entitlements de plan réellement appliqués côté API (STARTER refusé sur marketing/assistant) → une mutation autorisée bout en bout (dismiss d'une recommandation) **re-vérifiée en base** après l'appel HTTP → déconnexion réelle → reconnexion réelle avec les mêmes identifiants, accès restauré.
- **`scripts/forced-failure.ts`** (`npm run forced-failure`, 6/6) : panne Postgres **réellement provoquée** (`service postgresql stop`) pendant que `next start` continue de tourner — `/api/health` rapporte réellement `503`/"degraded" (jamais un `200` menteur), le processus reste vivant, et se rétablit automatiquement à `200` dès Postgres restauré, sans jamais redémarrer l'application.

Commit `16947f8`.

## 10. 🔐 READY_FOR_OWNER_AUTHORIZATION — Owner E2E réel (cérémonie WebAuthn)

**Ne peut structurellement pas être scripté par un agent** — la cérémonie WebAuthn/FIDO2 exige l'authenticateur physique de l'Owner lui-même (empreinte, clé de sécurité, Face ID/Windows Hello selon l'appareil). Ceci reste vrai indépendamment de l'outillage disponible : simuler cette étape reviendrait à contourner la garantie de sécurité même que le mandat demande de vérifier. Checklist réelle à exécuter par l'Owner (les 10 flux du Mandat 2, réutilisés tels que documentés le 06/09/2026, toujours exacts) :

1. Connexion Platform Owner : login classique (`/login`, email/password).
2. Enregistrement passkey : `/owner-auth` → "Enregistrer une clé" → cérémonie WebAuthn du navigateur/OS.
3. Reconnexion par passkey : `/owner-auth` → "Se connecter avec ma clé".
4. Accès à AI Lab : `/ai-lab` se charge — inclut désormais les onglets Outcomes et Observability livrés ce segment.
5. Refus d'un compte non-Owner : `CapabilityError` avant même la vérification WebAuthn.
6. Action sensible demandant step-up (ex. `PATCH /api/ai-lab/policy`) sans step-up récent → `403` explicite.
7. Validation step-up réussie (`POST /api/owner/step-up/options` puis `/verify`) → l'action sensible passe ensuite.
8. Révocation d'une session (`GET /api/owner/sessions` puis `POST /api/owner/sessions/:id/revoke`).
9. Kill Switch Owner (`PATCH /api/ai-lab/policy`).
10. Audit de ces opérations, visible via `GET /api/ai-lab/audit`.

Aucune de ces 10 étapes ne nécessite plus de code — elles nécessitent la présence physique de l'Owner devant son propre authenticateur.

## 11. Connecteurs — état réel inchangé (7 réels / 31, 24 architecture-only)

Inchangé depuis la matrice précédente : Shopify, Google Analytics, Judge.me, CJ Dropshipping, GitHub, Klaviyo, Windsor.ai réellement câblés et testés. Les 24 restants (Google Workspace, Microsoft 365, Notion, Slack, Adobe, Canva, Meta/TikTok/Google Ads, etc.) restent honnêtement `NOT_CONFIGURED` — chacun bloqué par une app OAuth2 à enregistrer ou une clé API à coller en variable d'environnement Vercel, une décision/action Owner nommée et précise, jamais une lacune de code.

## 12. ✅ VERIFIED — Déploiement production du dernier commit (`16947f8`)

**Résolu depuis la rédaction initiale de cette section.** Le déploiement Vercel qui servait encore `5067539` a rattrapé `master` : `GET https://intelligence.ondeal.fr/api/health` confirme désormais `"commit":"16947f877b5da494f93e0556cf737bc16e5da575"`, `"status":"ok"`, `"database":"ok"` — vérifié par 3 requêtes consécutives (pas un blip réseau). Smoke production complet re-passé sur ce commit exact :

- `GET /login` → `200`
- `GET /owner-auth` → `200`
- `GET /api/health` → `200`
- `GET /api/ai-lab/observability` sans session → `403` (jamais un `500`, jamais un accès accordé sans capacité Owner)

Aucune action Owner n'était finalement nécessaire au-delà du push déjà effectué — l'auto-déploiement Vercel a simplement pris plus de temps que les vérifications précédentes.

## 13. ⚪ NON CONSTRUIT — ce qui reste, précisément

- **Team invites (invitation de membres)** : bloqué sur l'absence de fournisseur d'email — voir §8. Passera en 🔐 READY_FOR_OWNER_AUTHORIZATION dès qu'une clé de fournisseur (Resend/SendGrid/Postmark) est fournie.
- **Suppliers / Reports / Agency Workspace (pages réelles)** : promis au tarif PRO/BUSINESS/AGENCY, honnêtement marqués "(bientôt)" depuis ce segment (§8) plutôt que faussement actifs — construction future, aucun blocage externe identifié, juste pas encore priorisé.
- **API publique marchande** : aucune conception de surface d'API externe (clés API par organisation, rate limiting, documentation) n'existe encore — chantier produit à définir avant tout code.
- **24 connecteurs architecture-only** : voir §11.

---

## Ce que l'Owner doit faire maintenant (dans l'ordre)

1. Exécuter les 10 flux du Mandat 2 (§10) depuis `/owner-auth` en production (`16947f8` est désormais bien en ligne) — seule étape qui vous appartient structurellement, personne d'autre ne peut la faire à votre place.
2. Pour chaque connecteur architecture-only qui vous intéresse (§11) : enregistrer l'app OAuth2 ou coller la clé API en variable d'environnement Vercel.
3. Décider si les pages Suppliers/Reports/Agency Workspace (§13) doivent être priorisées, ou si "(bientôt)" reste correct pour l'instant.
4. Si vous voulez activer les invitations d'équipe (§8, §13) : fournir une clé de fournisseur d'email (Resend/SendGrid/Postmark).

Aucune de ces étapes ne nécessite plus de code de ma part — je reste prêt à continuer immédiatement sur tout chantier encore ouvert dès que ces décisions sont prises.
