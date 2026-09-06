# 17 — Runbook opérationnel

Guide d'exploitation quotidienne, écrit pour un ingénieur qui rejoint le projet sans historique préalable. Chaque procédure cite la route/le fichier réel — aucune commande hypothétique.

## 1. Vérifier l'état de santé du système

- `GET /api/health` (public, sans authentification) — retourne `status`, `VERCEL_GIT_COMMIT_SHA`, l'état de connectivité base de données. Utilisé tout au long de ce dossier pour confirmer le SHA déployé sans passer par le tableau de bord Vercel.
- Onglet **Observability** du cockpit Owner (`/ai-lab`, nécessite session Owner) — fenêtre 24h, seuils fixes, missions bloquées signalées.
- Onglet **Outcomes** — compteur de missions total, taux de succès.

## 2. Déployer une nouvelle version

Procédure réellement utilisée ce jour (voir aussi 19-CHANGELOG-AND-GIT-EVIDENCE.md pour l'historique complet des livraisons ayant suivi ce protocole) :

1. Dans l'environnement de développement : `tsc --noEmit`, `eslint`, `vitest run`, `npm run build`, `npm run e2e:smoke` — tous doivent être verts avant toute livraison.
2. `git bundle create <nom>.bundle <dernier-sha-connu-en-prod>..HEAD`.
3. Transférer le bundle vers la machine de l'Owner (actuellement via `SendUserFile` + `device_commit_files`, livré **un niveau au-dessus** du dossier du dépôt local — voir la note de chemin relatif ci-dessous).
4. Sur la machine de l'Owner, dans le dossier du dépôt : `git fetch ../<nom>.bundle master:<branche-temporaire>`.
5. `git merge --ff-only <branche-temporaire>`.
6. `git push origin master`.
7. Attendre le déploiement Vercel (build automatique déclenché par le push).
8. Revérifier `GET /api/health` → `VERCEL_GIT_COMMIT_SHA` doit correspondre exactement au SHA du commit livré.

**Piège de chemin déjà rencontré en production** : le bundle atterrit dans le dossier *parent* du dossier du dépôt (ex. `...\ondeal-intelligence-deploy\` alors que le dépôt est dans `...\ondeal-intelligence-deploy\ondeal-intelligence\`). Si l'Owner exécute `git fetch` depuis l'intérieur du dépôt, le chemin correct est `../<nom>.bundle`, pas `<nom>.bundle`.

## 3. Configurer ou corriger `PLATFORM_OWNER_USER_IDS`

Incident réel déjà rencontré et résolu ce jour — procédure extraite de cette résolution :

1. Se connecter normalement (`/login`), puis visiter `/owner-auth`.
2. Si l'accès Owner est refusé ("Réservé au Platform Owner"), la page affiche désormais (depuis le commit `fc3b3b3`) une boîte de diagnostic orange avec l'`userId` exact et l'email connecté, alimentée par `GET /api/owner/whoami`.
3. Copier cet `userId` exact dans la variable d'environnement Vercel `PLATFORM_OWNER_USER_IDS` (scope **Production**), séparé par une virgule si plusieurs Owners.
4. Redéployer (un simple push ou un redeploy manuel sur Vercel) — la variable n'est lue qu'au démarrage du process serveur.
5. Revenir sur `/owner-auth` et retenter l'enregistrement de la passkey.

## 4. Gérer une session Owner compromise ou à révoquer

- `GET /api/owner/sessions` (session Owner active requise) liste les sessions `PlatformOwnerSession` actives.
- `POST /api/owner/sessions/{id}/revoke` révoque une session spécifique immédiatement.
- Non encore exercé par l'Owner à date d'écriture (voir 15.A flux #8, 16 §2.8).

## 5. Actionner le Kill Switch global

- `PATCH /api/ai-lab/policy` avec `killSwitchEngaged:true`, nécessite step-up L3 récent (fenêtre 5 minutes).
- **Effet réel** : pause toutes les missions AI Lab en cours à la prochaine itération de boucle. **N'affecte jamais le Merchant Plane** (boutiques marchandes, sync Shopify/WooCommerce/etc. continuent de fonctionner normalement).
- Pour annuler : renvoyer `killSwitchEngaged:false` avec step-up frais.
- Distinct de l'annulation d'une mission individuelle (`requireCapability` seul, pas de step-up) qui n'arrête qu'une mission précise.

## 6. Interpréter un budget de mission dépassé ou une mission bloquée

- Chaque mission porte un `Hard Budget (USD)` fixé à la création. `evaluatePolicy()` refuse toute nouvelle action dès que le coût cumulé atteint ce plafond, indépendamment du budget global $20 par défaut.
- Une mission bloquée apparaît dans l'onglet Observability. Aucun mécanisme de retry automatique au niveau nœud n'existe (voir 03/13) — une mission bloquée par une erreur de nœud transitoire doit être relancée manuellement par l'Owner depuis l'onglet Missions.

## 7. Surveiller les connecteurs

- `GET` sur la registry des connecteurs Control Plane (`/api/ai-lab/connectors` ou équivalent) retourne pour chaque connecteur son statut réel — `CONNECTED`, `NOT_CONFIGURED` (jamais un statut fabriqué), avec `version` explicite (ex. `"0.0.0-architecture-only"` pour les connecteurs non construits).
- Un connecteur Merchant Plane en erreur (ex. incident CJDropshipping déjà survenu, voir 07) doit être diagnostiqué en premier lieu via les logs d'intégration (`src/lib/integrations/<provider>.ts`), pas via l'AI Lab.

## 8. Exécuter les suites de validation avant toute modification

Commandes réellement exécutées et confirmées ce jour (voir 06-TEST-EVIDENCE.md pour la sortie complète) :
```
service postgresql start && pg_isready
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
npm run e2e:smoke
```
**Prérequis récurrent** : au démarrage d'un environnement de développement frais, PostgreSQL local n'est pas toujours démarré — `pg_isready` avant tout, `service postgresql start` sinon. `vitest run` seul n'a pas besoin de PostgreSQL (tout mocké) ; `build` et `e2e:smoke` en ont besoin.

## 9. Ce runbook ne couvre pas

- La reprise après incident majeur (perte de données, corruption, indisponibilité prolongée d'un fournisseur externe) — voir 18-DISASTER-RECOVERY.md.
- L'exécution du protocole de première mission Owner réelle — voir 15-OWNER-ACCEPTANCE-PROTOCOL.md, Partie B.
