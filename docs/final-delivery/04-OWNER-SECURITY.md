# 04 — Platform Owner : dossier de sécurité

## Chaîne complète

```
ondeal_session (JWT HS256, 30j) — getCurrentUser()
        │
        ▼
isPlatformOwner(userId) — allowlist PLATFORM_OWNER_USER_IDS (jamais un rôle Membership)
        │
        ▼
GET /api/owner/whoami — auto-diagnostic : renvoie userId/email/isPlatformOwner à l'appelant lui-même,
        n'accorde aucune capacité (lecture seule, ajouté le 06/09/2026 après une friction réelle)
        │
        ▼
POST /api/owner/webauthn/register|login/options → challenge WebAuthn (5 min, à usage unique)
        │
        ▼
Cérémonie WebAuthn/FIDO2 (@simplewebauthn) — passkey de l'authenticateur physique de l'Owner
        │
        ▼
POST /api/owner/webauthn/register|login/verify → PlatformOwnerSession (cookie ondeal_owner_session, 7j)
        │
        ▼
requireCapability / requireCapabilityWithOwnerSession / requireCapabilityWithStepUp
        │
        ▼
AI Lab (14 modules) — chaque route gate individuellement, voir 02-AI-LAB-ARCHITECTURE.md
```

## Séparation Merchant / Owner

`isPlatformOwner()` ne teste jamais un rôle `Membership` — uniquement l'appartenance à `PLATFORM_OWNER_USER_IDS` (variable d'environnement, `src/lib/authz/capabilities.ts:49`). Un `Role.OWNER` métier (propriétaire d'une boutique cliente) n'obtient aucune capacité Control Plane — **prouvé par le red-team réel** (§ci-dessous, test 2/3).

## Protection des routes (`src/app/api/owner/**`)

| Route | Exigence exacte | Codes d'échec |
|---|---|---|
| `GET /api/owner/whoami` | session normale uniquement | 401 |
| `POST /api/owner/webauthn/register/options` | session + `isPlatformOwner` | 401 / 403 / 400 |
| `POST /api/owner/webauthn/register/verify` | idem + corps zod | 401 / 403 / 400 |
| `POST /api/owner/webauthn/login/options` | idem | 401 / 403 / 400 |
| `POST /api/owner/webauthn/login/verify` | idem + rate limit 20/15min par IP | 401 / 403 / **429** / 400 |
| `POST /api/owner/step-up/options` | session Owner déjà ouverte (`requireOwnerSession`) | 401 / 403 / 400 |
| `POST /api/owner/step-up/verify` | idem + vérification WebAuthn dédiée | 401 / 403 / 400 |
| `GET /api/owner/sessions` | `requireOwnerSession` | 401 / 403 |
| `POST /api/owner/sessions/[id]/revoke` | `requireStepUp` (pas seulement session) | 401 / 403 / 404 |
| `POST /api/owner/recovery/consume` | sans session — rate limit 10/60min + mot de passe + code | **429** / 400 / 401 |

## WebAuthn/FIDO2 — mécanique exacte

- Librairie `@simplewebauthn/server`/`browser`. `rpID`/`rpName`/`origin` dérivés uniquement de `APP_URL` (jamais des en-têtes de la requête — empêche un `Origin`/`Host` falsifié de passer la vérification).
- Challenge à usage unique : `consumeChallenge` supprime la ligne en base **avant** de vérifier son expiration — un challenge est consommé même si la vérification échoue ensuite (anti-rejeu).
- **Protection anti-clonage (anti-replay), logique exacte** : le compteur de signature FIDO2 doit strictement augmenter à chaque authentification ; s'il n'augmente pas (hors cas 0→0 pour les authenticateurs qui n'incrémentent jamais), la credential est **automatiquement et définitivement révoquée** (`src/lib/authz/webauthn.ts`).
- `requireUserVerification: true` sur l'enregistrement et l'authentification.

## Sessions Owner et step-up

- `PlatformOwnerSession` : cookie séparé `ondeal_owner_session`, httpOnly, 7 jours (plus court que la session applicative de 30 jours). IP jamais stockée en clair (hash SHA-256 tronqué).
- Step-up : fenêtre exacte **5 minutes** (`STEP_UP_TTL_MS`), vérifiée par comparaison d'horodatage à la lecture — pas de job en arrière-plan.
- Révocation : `revokeOwnerSession` idempotent (retourne si une ligne a réellement été mise à jour) ; `revokeAllOwnerSessions` (tout révoquer) documenté comme "Kill Switch Owner élargi" mais **distinct** du kill switch global `SystemPolicy` — ne pas confondre les deux dans une communication à l'Owner.

## Récupération (recovery codes)

- 10 codes générés à l'enregistrement de la première credential, format `XXXX-XXXX-XXXX` (alphabet réduit sans `0/O/1/I`), affichés une seule fois, jamais journalisés en clair.
- Stockage : hash SHA-256 uniquement. Usage unique réel (`usedAt` posé à la consommation, `findFirst` exige `usedAt: null`).
- Régénérer invalide immédiatement tous les codes non utilisés précédents.
- Une connexion par recovery code n'ouvre qu'une session `L2_PASSKEY` — jamais `L3_STEP_UP` directement, donc toute action step-up (y compris le kill switch) exige malgré tout une nouvelle cérémonie WebAuthn ensuite.

## CSRF

Double-submit cookie (`ondeal_csrf` / `x-csrf-token`), appliqué à toute route mutative sous `/api/*` non exemptée — **aucune route `/api/owner/*` ou `/api/ai-lab/*` n'est exemptée**. Logique exacte citée en 01-SYSTEM-ARCHITECTURE.md.

## Policy Engine — matrice de décision exacte

`evaluatePolicy()` (`src/lib/ai/policy/engine.ts`), dans l'ordre :
1. Kill switch engagé → **DENY** (toute classe de risque, y compris COGNITION).
2. Budget de mission dépassé → DENY.
3. Budget global (`maxHardBudgetUsdGlobal`, $20 par défaut) dépassé → DENY.
4. Sinon, par classe de risque : COGNITION toujours `ALLOW_AUTO` ; `SANDBOX_EFFECT` autorisé seulement en environnement SANDBOX ; `EXTERNAL_READ` nécessite approbation en ASSIST seulement ; `EXTERNAL_WRITE` toujours `REQUIRE_APPROVAL` ; `PRODUCTION_EFFECT` DENY par défaut, `REQUIRE_APPROVAL` seulement si explicitement activé — jamais `ALLOW_AUTO`.

Testé exhaustivement par `tests/policyEngine.test.ts` (voir 06-TEST-EVIDENCE.md).

## Kill switch — ce qu'il arrête réellement

Deux mécanismes distincts, tous deux coopératifs (jamais une coupure forcée du processus) :

1. **Kill switch global** (`SystemPolicy.killSwitchEngaged`) : écrit uniquement via `PATCH /api/ai-lab/policy`, gate `requireCapabilityWithStepUp` — nécessite donc l'allowlist **et** une ré-élévation WebAuthn <5 min. Consommé à **chaque itération** de la boucle Supervisor (pas seulement au démarrage) : une mission en cours passe en `PAUSED` dès l'itération suivante. N'affecte que les missions AI Lab — n'a aucun effet sur la synchro Shopify, les webhooks, ou les crons.
2. **Annulation par mission** (`requestMissionCancellation`) : gate `requireCapability` seul (pas de step-up requis), coopérative également.

## Audit trail

`AiLabAuditLog`, append-only par convention de code (aucune fonction update/delete exportée). Ne journalise jamais un secret en clair (contrat documenté, non vérifié mécaniquement par le code).

## Tests négatifs réels (§7 du mandat)

- `GET /api/owner/whoami` sans session → **401** (vérifié : `curl` production le 06/09/2026).
- `GET /api/ai-lab/observability`, `/outcomes`, `/missions` sans session → **403** (vérifié en production).
- Red-team réel (§8 du mandat, voir 08-RED-TEAM-FAILURE-MATRIX.md) : un `Role.OWNER` métier légitime (compte marchand) tentant `POST /api/coder-missions` (capacité `SYSTEM_CODER`) → **403 réel**, prouvant que le rôle métier n'accorde jamais une capacité Control Plane.

## Vérification Owner réelle (06/09/2026)

Le Platform Owner (contact@ondeal.fr) a réellement : (1) rencontré et corrigé une friction de configuration (`PLATFORM_OWNER_USER_IDS` non encore renseignée — résolue via l'ajout de la route `/api/owner/whoami`), (2) enregistré une passkey WebAuthn réelle (confirmée par la notification native "Clé d'accès enregistrée" de Chrome), (3) accédé à `/ai-lab` en production avec le header confirmant `"contact@ondeal.fr — Platform Owner"`. Détail complet et suite du protocole en 15-OWNER-ACCEPTANCE-PROTOCOL.md.
