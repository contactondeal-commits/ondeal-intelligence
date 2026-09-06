# 06 — Preuves de test réelles (exécutées le 06/09/2026)

Toutes les commandes ci-dessous ont été réellement exécutées pendant la constitution de ce dossier, dans cet ordre, sur le HEAD `fc3b3b3`. Aucun résultat n'est reporté d'une session antérieure sans ré-exécution.

## 1. Typecheck

```
$ npx tsc --noEmit
```
**Résultat : propre, 0 erreur.**

## 2. Lint

```
$ npx eslint .
✖ 6 problems (0 errors, 6 warnings)
```
**0 erreur. 6 avertissements pré-existants, sans rapport avec ce mandat** (usage de `<img>` au lieu de `<Image/>`, directives eslint-disable inutilisées, `window.location.href` au lieu de `router.push`) — non bloquants, listés pour transparence.

## 3. Tests unitaires/intégration

```
$ npx vitest run
 Test Files  68 passed (68)
      Tests  538 passed (538)
   Duration  33.09s
```
**538/538, 68/68 fichiers.**

## 4. Build production

```
$ npm run build
```
**Résultat : build Next.js 16/Turbopack réussi, toutes les routes compilées (statiques et dynamiques listées dans la sortie de build).**

## 5. e2e:smoke (build de production réel, `next start`, vraie base Postgres locale)

```
$ npm run e2e:smoke
[e2e-smoke] 27/27 vérifications réussies.
```
Couvre : pages publiques (200), redirections (307), `/owner-auth` (jamais 500), routes AI Lab sans session (403 systématique, jamais 500 — y compris `/api/ai-lab/tools`/`missions` qui avaient régressé en 500 en production avant le correctif du 05/09/2026), `/api/health` (200), routes `/api/owner/*` sans session (401), méthode non supportée (405), route inconnue (404).

## 6. Merchant E2E réel (parcours marchand complet, signup→onboarding→mutations→logout/login)

```
$ npm run merchant-e2e
[merchant-e2e] 14/14 étapes du parcours marchand réel réussies.
```
Détail : signup réel, onboarding démo (`storeId` réel créé), 5 pages authentifiées à 200, 2 entitlements STARTER vérifiés en 403 réel (marketing, assistant), une mutation autorisée (`dismiss` recommandation) **re-vérifiée directement en base** après l'appel HTTP, déconnexion réelle (accès révoqué, 307), reconnexion réelle (accès restauré, 200).

## 7. Red-team (attaques adverses réelles)

```
$ npm run red-team
[red-team] 3/3 défense(s) tiennent face à une attaque réelle.
```
1. IDOR Merchant Plane (compte A écrit sur boutique de B) → 403 réel.
2. Isolation Control Plane (Role.OWNER métier tente SYSTEM_CODER) → 403 réel, indépendant du rôle Membership.
3. Rate limiting anti-brute-force (12 tentatives de mot de passe erroné) → 429 déclenché avant la 12e tentative.

## 8. Forced-failure (panne Postgres réellement provoquée)

```
$ npm run forced-failure
[forced-failure] 6/6 affirmation(s) de résilience vérifiée(s) par une panne réellement provoquée.
```
Avant panne : `/api/health` → 200/ok. Panne réelle (`service postgresql stop`) : `/api/health` → **503/degraded**, message d'erreur réel capturé (`"Server has closed the connection."`), processus Next.js resté vivant (page publique toujours 200). Restauration réelle (`service postgresql start`) : `/api/health` revient à 200/ok, **même PID de processus** du début à la fin — aucun redémarrage nécessaire.

## Résumé chiffré

| Suite | Résultat |
|---|---|
| tsc --noEmit | ✅ propre |
| eslint | ✅ 0 erreur / 6 avertissements pré-existants |
| vitest | ✅ 538/538 (68 fichiers) |
| build | ✅ réussi |
| e2e:smoke | ✅ 27/27 |
| merchant-e2e | ✅ 14/14 |
| red-team | ✅ 3/3 |
| forced-failure | ✅ 6/6 |

**Aucune commande listée ci-dessus n'a été déclarée PASS sans exécution réelle pendant la constitution de ce dossier.**
