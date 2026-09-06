# 19 — Changelog et preuves Git

Historique réel et complet du dépôt à la date de rédaction, extrait directement de `git log --oneline --reverse` (45 commits, du premier au HEAD actuel `fc3b3b3`). Aucune ligne ci-dessous n'est reconstituée de mémoire — c'est la sortie brute de la commande, réorganisée par phase.

## HEAD au moment de la rédaction

```
fc3b3b36cd49638b97ae7d97182a6b4bf9987b22
```
Confirmé identique en production via `GET /api/health` → `VERCEL_GIT_COMMIT_SHA` (voir 07-PRODUCTION-VERIFICATION.md).

## Phase — ONDEAL AI JOB ENGINE (fondation, avant la numérotation par phase)

```
96e835c Add ONDEAL AI JOB ENGINE reference loop tests
1d02dc8 Add ONDEAL AI JOB ENGINE job-type registry (analyze_margin_risk)
7dcbdeb Add ONDEAL AI JOB ENGINE real task: analyze_margin_risk (collect/reason/verify)
b1d4c89 Add ONDEAL AI JOB ENGINE POST /api/jobs/[id]/run (real on-demand worker)
cac47e6 Add claimJobById() to ONDEAL AI JOB ENGINE store.ts (on-demand claim guard)
7e0d55d Expose step output/error in GET /api/jobs/[id] (evidence + user-visible result)
c73175a Add ONDEAL AI JOB ENGINE tests for analyze_margin_risk (9 tests)
```
Fondation du moteur de jobs asynchrones — boucle collecte/raisonnement/vérification, avant l'introduction du Model Router et du Policy Engine.

## PHASE 2 — Model Router / Model Evaluation (17 commits numérotés)

```
0aaf392 Add estimateCostUsd — coût observable réel (PHASE 2, 1/14)
55d1344 Add GROUNDING_TASKS — jeu de tâches fixe pour évaluation de modèles (PHASE 2, 2/14)
6c0e5a7 Add ModelEvalRun/ModelEvalResult schema — PHASE 2 (3/17, additive)
30a6258 Fix corrupted baseline migration tail — PHASE 2 (4/17)
20392ba Add add_model_eval migration — PHASE 2 (5/17, additive)
000edb9 Fix claude-fable-5-1 pricing/context — verified 06/09/2026 (PHASE 2, 6/17)
b34b643 Add real EvaluationRunner — runModelEvaluation (PHASE 2, 7/17)
8219c43 Add real ModelRouter — chooseModel (PHASE 2, 8/17)
4279a75 Wire costUsd into analyze_margin_risk reasonStep (PHASE 2, 9/17)
4ab5892 Add Control Plane capability seed — requireCapability/isPlatformOwner (PHASE 2, 10/17)
dd5872a Add GET /api/model-evaluations — Control Plane, capability-gated (PHASE 2, 11/17)
f6efc4e Add POST /api/model-evaluations/run — Control Plane, capability-gated (PHASE 2, 12/17)
fc490e7 Document PLATFORM_OWNER_USER_IDS in .env.example (PHASE 2, 13/17)
1fcb26c Assert costUsd in jobsMarginRisk test — cost observability (PHASE 2, 14/17)
af121da Add real ModelEvaluation tests — cost observability + no-partial-theater (PHASE 2, 15/17)
be73ad3 Add real ModelRouter tests — chooseModel (PHASE 2, 16/17)
329540c Add Control Plane capability tests — STORE ADMIN != ONDEAL OWNER (PHASE 2, 17/17)
```
Introduction du distinguo **Control Plane / Merchant Plane** (`isPlatformOwner` ≠ rôle métier `OWNER`) — fondation directe de toute la sécurité Owner documentée en 04-OWNER-SECURITY.md. `PLATFORM_OWNER_USER_IDS` documenté ici pour la première fois (commit `fc490e7`) — c'est cette même variable dont l'absence a causé la friction Owner résolue ce jour (voir §Owner E2E ci-dessous).

## PHASE 3 — Coder Agent

```
69232c3 PHASE 3 — Coder Agent (sandbox + navigateur + vision) : fondation réelle
```
Fondation sandbox + navigateur automatisé + vision (revue d'écran) pour l'agent codeur.

## PHASE 4 — Storefront Intelligence Engine

```
a2015e3 PHASE 4 — Storefront Intelligence Engine : Supervisor + graphe dynamique (vertical slice réel)
```
Premier Supervisor réel avec graphe d'exécution dynamique — tranche verticale complète (pas une maquette).

## PHASE 5 — AI Lab Ultimate (14 commits, la phase la plus large)

```
f190de6 PHASE 5 — AI Lab Ultimate : Owner Control Center + Policy Engine + Supervisor généralisé (fondation réelle)
be0f504 PHASE 5 (suite) — Owner Strong Auth (WebAuthn/FIDO2) + Provider Continuity + Agent/Memory foundations (clôture partielle réelle)
aa2b526 PHASE 5 (suite) — AI Lab Ultimate : interface Owner réelle (clôture de la tâche exigée par l'Owner)
019d17e PHASE 5 (suite) — Experiment Mode réel (§51-53), clôture réelle
7131229 PHASE 5 (suite) — System Evolution Console réel (§61-65), clôture réelle
f5ac736 PHASE 5 (suite) — SSE temps réel pour la progression de mission (§12), clôture réelle
ee266dd PHASE 5 (suite) — Multi-viewport natif dans le graphe Coder Agent (§201/§30), clôture réelle
308472c PHASE 5 (suite) — Provider de génération d'image réel (§41/§202), clôture réelle
eaad765 PHASE 5 (suite) — Connecteur Klaviyo réel, 1er des ~24 connecteurs restants, progrès réel
c7f62df PHASE 5 (suite) — Connecteur Windsor.ai réel, 2e des ~23 connecteurs restants, progrès réel
e2f53ff PHASE 5 (suite) — Premier vrai test E2E (§204), build de production réel contre la vraie base
9b0f53b PHASE 5 (suite) — Correctif production réel : 500 sur /api/ai-lab/tools et /api/ai-lab/missions
```
Introduit dans l'ordre : Policy Engine + Owner Control Center, WebAuthn/FIDO2 réel, interface AI Lab complète, Experiment Mode, System Evolution (auto-amélioration supervisée), SSE temps réel, vision multi-viewport, génération d'image réelle, 2 connecteurs Control Plane réels (Klaviyo, Windsor.ai), premier test E2E réel, un correctif de production réel (500 sur deux routes AI Lab — preuve qu'un bug de production a été rencontré et corrigé, pas seulement anticipé).

## FINAL PHASE — Clôture, sécurité, preuve de production (6 commits)

```
5a41570 FINAL PHASE — Outcome/ROI Engine réel, câblé au cockpit Owner (§Outcome/ROI Engine)
58e5b8e FINAL PHASE — Security/Red-Team réel (§sécurité/red-team) + correctif lint owner-auth
4ca5b3e FINAL PHASE — Merchant Plane : PlanLimit.maxProducts réellement appliqué (§entitlements)
5067539 FINAL PHASE — Observabilité réelle (§observabilité) : sonde de santé publique + Owner Cockpit
cbba32f FINAL PHASE — Merchant Plane : intégrité réelle des 6 features fantômes de PLAN_FEATURES
16947f8 FINAL PHASE — Merchant E2E réel + test de panne forcée réel (§E2E, §panne forcée)
fc3b3b3 FINAL PHASE — Owner : auto-diagnostic whoami (§Owner E2E, friction réelle rencontrée)
```
Ferme les boucles ouvertes : ROI mesurable, red-team réel (403 vérifiés, pas supposés), entitlements SaaS réellement enforced, observabilité publique, cohérence des features non construites, E2E marchand complet + preuve de résilience par panne réellement provoquée, et enfin le correctif né de la première tentative réelle de l'Owner d'exécuter la checklist §10 en production.

## §Owner E2E — friction réelle rencontrée et résolue ce jour (hors commit, séquence complète)

1. L'Owner tente l'enregistrement de sa passkey sur `/owner-auth` en production → aucune réaction visible.
2. Diagnostic : hypothèse d'une popup WebAuthn masquée → écartée.
3. Nouvel essai → erreur `"Failed to fetch"` observée dans les DevTools (2 requêtes `options` en échec, statut 403).
4. Vérification directe par `curl` : le serveur répond bien (403 JSON), donc pas un problème réseau/serveur — recommandation de tester en navigation privée pour écarter une extension Chrome.
5. En navigation privée → erreur précise et différente : `"Réservé au Platform Owner."` — confirme que le blocage est une décision applicative volontaire (`isPlatformOwner()`), pas un bug réseau.
6. Lecture directe du code (`src/lib/authz/capabilities.ts`, `src/app/api/owner/webauthn/register/options/route.ts`) : la cause racine est que `PLATFORM_OWNER_USER_IDS` en production ne contient pas l'`userId` réel de l'Owner — variable documentée depuis le commit `fc490e7` (PHASE 2) mais jamais renseignée avec la bonne valeur en production.
7. Aucun accès direct à la base de production pour lire cet `userId` → construction du endpoint `GET /api/owner/whoami` (commit `fc3b3b3`), volontairement accessible même à un utilisateur non-Owner (contrairement aux routes `webauthn/*` qui renvoient 403), afin de rester utilisable *pendant* le diagnostic lui-même.
8. L'Owner lit son `userId` exact (`cmt1n85s200001504pudabuin`) dans la boîte de diagnostic orange, le renseigne dans la variable Vercel `PLATFORM_OWNER_USER_IDS` (scope Production), redéploie.
9. Nouvel essai → succès complet : notification native Chrome "Clé d'accès enregistrée", accès à `/dashboard` puis `/ai-lab` confirmé par capture d'écran (header "contact@ondeal.fr — Platform Owner", badge "SYSTEM LIVE", 14 onglets visibles incluant Outcomes et Observability).

Cette séquence constitue la preuve `OWNER VERIFIED` citée pour les flux #1, #2 et #4 de 15-OWNER-ACCEPTANCE-PROTOCOL.md et pour les lignes 2.1-2.3 de 16-FINAL-ACCEPTANCE-MATRIX.md — elle a été vécue en temps réel dans cette même conversation, pas rapportée après coup.

## Convention de nommage observée

Aucune convention Conventional Commits (`feat:`, `fix:`) n'est utilisée dans ce dépôt — chaque message de commit porte plutôt une étiquette de phase (`PHASE 2`, `PHASE 3`, `PHASE 5 (suite)`, `FINAL PHASE`) suivie d'une description en français de ce qui a été réellement construit ou corrigé, souvent avec une référence à la section du mandat qui l'a demandé (ex. `§entitlements`, `§observabilité`). Ce dossier de livraison poursuit cette même convention pour son propre commit de clôture (voir README.md et la procédure de livraison Git finale).
