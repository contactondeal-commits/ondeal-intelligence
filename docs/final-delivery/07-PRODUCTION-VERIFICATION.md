# 07 — Vérification production réelle

Toutes les vérifications ci-dessous ont été exécutées le 06/09/2026 contre `https://intelligence.ondeal.fr`, en direct, pendant la constitution de ce dossier.

## SHA déployé vs. HEAD attendu

- **HEAD Git attendu** : `fc3b3b36cd49638b97ae7d97182a6b4bf9987b22`.
- **Commit servi en production** (`GET /api/health`, 3 requêtes consécutives à des minutes différentes pour exclure un artefact réseau) :
```json
{"status":"ok","database":"ok","databaseError":null,"commit":"fc3b3b36cd49638b97ae7d97182a6b4bf9987b22","environment":"production","timestamp":"2026-09-06T16:44:44.808Z"}
```
**Le SHA déployé correspond exactement au HEAD attendu. Production validée sur cette base uniquement.**

## Base de données

`database:"ok"`, `databaseError:null` — sonde réelle (`SELECT 1`), jamais une valeur supposée.

## Pages critiques (statuts réels)

| Page | Statut | Attendu |
|---|---|---|
| `/login` | 200 | 200 |
| `/signup` | 200 | 200 |
| `/owner-auth` | 200 | 200 |
| `/dashboard` (sans session) | 307 | redirection, jamais 200 ni 500 |
| `/pricing` (sans session) | 307 | redirection |

## Protections Owner / routes critiques (sans session)

| Route | Statut | Attendu |
|---|---|---|
| `GET /api/owner/whoami` | 401 | 401 (self-diagnostic, pas de capacité accordée) |
| `GET /api/owner/sessions` | 401 | 401 |
| `GET /api/ai-lab/observability` | 403 | 403 |
| `GET /api/ai-lab/outcomes` | 403 | 403 |
| `GET /api/ai-lab/missions` | 403 | 403 |
| `GET /api/coder-missions` | 403 | 403 |

**Aucun 500 constaté sur le périmètre testé.**

## AI Lab en production (vérifié par l'Owner lui-même, pas seulement par curl)

Le 06/09/2026, le Platform Owner (contact@ondeal.fr) a personnellement chargé `https://intelligence.ondeal.fr/ai-lab` après une cérémonie WebAuthn réelle réussie. Le header affichait "contact@ondeal.fr — Platform Owner", "SYSTEM LIVE", et les 14 onglets attendus dont **Outcomes** et **Observability** (livrés ce segment). Capture d'écran fournie par l'Owner en conversation, confirmant visuellement l'état — voir 15-OWNER-ACCEPTANCE-PROTOCOL.md pour le détail de la session.

## Incident et résolution rencontrés pendant cette vérification (transparence)

Le déploiement Vercel du commit `fc3b3b3` a d'abord accusé un retard (`/api/health` continuait à servir le commit précédent `5067539` pendant plusieurs minutes après le push) — comportement déjà documenté comme récurrent (auto-déploiement Vercel non toujours immédiat). Résolu sans action supplémentaire après quelques minutes ; confirmé par re-polling de `/api/health`, jamais supposé.

Séparément, une vraie friction de configuration a été rencontrée et corrigée en direct : `PLATFORM_OWNER_USER_IDS` n'était pas encore renseignée en production, bloquant honnêtement l'enregistrement de la passkey Owner (`403 "Réservé au Platform Owner."`) — un comportement de sécurité correct, pas un bug. Un nouvel endpoint (`GET /api/owner/whoami`) a été construit, testé (3 tests), déployé, et vérifié pour permettre à l'Owner de découvrir son `userId` exact et corriger la variable d'environnement lui-même. Après correction et redéploiement, l'enregistrement de la passkey a réussi.

## Conclusion

Production et HEAD Git sont alignés au moment de la rédaction. Aucune page critique testée ne renvoie 500. Les routes Owner/AI Lab refusent correctement l'accès sans authentification/capacité appropriée.
