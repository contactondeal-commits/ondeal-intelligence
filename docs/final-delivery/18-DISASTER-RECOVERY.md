# 18 — Reprise après incident (Disaster Recovery)

Ce document distingue strictement ce qui a été **réellement provoqué et observé** (une coupure Postgres courte) de ce qui reste une **procédure documentée mais non testée en conditions réelles** (tout le reste). Aucune des deux catégories n'est mélangée.

## 1. Scénario réellement testé : coupure Postgres courte

**Script** : `scripts/forced-failure.ts` (`npm run forced-failure`), commit `16947f8`. Contrairement à un test unitaire qui *mocke* une panne, ce script provoque une **vraie panne** : arrêt réel du service PostgreSQL local pendant que le serveur `next start` (build de production réel) est en cours d'exécution.

### Protocole exécuté

1. **Avant la panne** — `GET /api/health` interrogé : `200`, `body.status === "ok"` (mesure de référence).
2. **Provocation réelle** — `service postgresql stop`, puis confirmation par `pg_isready` que Postgres est effectivement arrêté (si `pg_isready` répondait encore, le script marque le résultat suivant comme non concluant plutôt que de fabriquer un succès).
3. **Pendant la panne** :
   - `GET /api/health` doit répondre **503** avec `status:"degraded"` — jamais un `200` qui masquerait la panne à un moniteur externe.
   - Le processus `next-server` lui-même doit rester **vivant** — répondre toujours aux requêtes HTTP (même en erreur), jamais planter/crasher.
4. **Restauration réelle** — `service postgresql start`, puis nouvelle mesure confirmant le retour à `200`/`"ok"` sans redémarrage manuel du processus Next.js (le même process survit à la coupure et se rétablit seul dès que la base répond à nouveau).

### Résultat constaté

Toutes les affirmations de résilience testées par ce script ont été vérifiées vraies lors de l'exécution documentée dans 06-TEST-EVIDENCE.md et 07-PRODUCTION-VERIFICATION.md : dégradation honnête (503, jamais un faux 200), process survivant, reprise automatique sans intervention manuelle sur le process serveur lui-même (seul Postgres a dû être redémarré, ce qui est le geste attendu en exploitation réelle).

### Ce que ce test ne couvre pas

- Une coupure **prolongée** (heures/jours) plutôt que quelques secondes.
- Une **corruption** de données plutôt qu'une simple indisponibilité.
- Une panne du **fournisseur d'hébergement** de la base (Vercel Postgres / Neon / autre) plutôt qu'un arrêt local volontaire.
- Une panne simultanée de **plusieurs composants** (base + un fournisseur externe critique en même temps).

## 2. Scénarios documentés mais jamais provoqués réellement

Pour chacun, la procédure ci-dessous est la meilleure pratique déductible de l'architecture réelle du dépôt — elle n'a **pas** été exécutée, et est donc à traiter comme une hypothèse de travail à valider avant qu'un incident réel ne survienne.

### 2.1 — Perte totale de la base de données de production

- **Détection** : `/api/health` passe et reste en `503`/`"degraded"` malgré Postgres signalé disponible côté fournisseur → suspecter une corruption/suppression plutôt qu'une simple coupure réseau.
- **Procédure présumée** : restauration depuis le dernier snapshot automatique du fournisseur d'hébergement Postgres (mécanisme externe au dépôt — dépend du fournisseur choisi, non documenté dans ce dépôt). Après restauration, exécuter `prisma migrate deploy` pour vérifier la cohérence du schéma avant de rouvrir le trafic.
- **Non testé** : aucun exercice de restauration depuis snapshot n'a été réalisé à ce jour.

### 2.2 — Compromission d'une clé/secret (`AUTH_SECRET`, clé de chiffrement `PlatformIntegration`, clé API d'un connecteur)

- **Procédure présumée** : rotation immédiate de la variable d'environnement Vercel concernée, redéploiement. Pour `AUTH_SECRET` : la rotation invalide **toutes** les sessions actives (`ondeal_session` signé HS256) — attendu et acceptable en scénario d'urgence.
- Pour la clé de chiffrement AES-256-GCM des `PlatformIntegration` (credentials GitHub/Klaviyo/Windsor.ai) : une rotation de clé sans migration des lignes déjà chiffrées **rend ces credentials illisibles** — nécessiterait une ré-authentification complète de chaque connecteur platform-scoped après rotation. Non testé.

### 2.3 — Incident fournisseur externe critique (Shopify, Vercel, GitHub)

- Shopify indisponible → le Merchant Plane dégrade gracieusement par construction (chaque appel d'intégration est déjà entouré de gestion d'erreur réelle, voir `src/lib/integrations/shopify.ts`), mais aucun test de panne forcée dédié à Shopify n'a été exécuté (contrairement à Postgres).
- Vercel indisponible → hors du contrôle du dépôt ; aucune stratégie multi-hébergeur n'existe.
- GitHub indisponible → bloque uniquement le System Evolution (auto-amélioration), aucun impact sur le Merchant Plane ni sur les missions AI Lab en cours (le connecteur GitHub n'est pas sur le chemin critique d'exécution d'une mission).

### 2.4 — Kill switch déclenché par erreur en production

- Effet réel et scope exacts déjà documentés (04-OWNER-SECURITY.md, 08-RED-TEAM-FAILURE-MATRIX.md) : pause de toutes les missions AI Lab, **aucun effet sur le Merchant Plane**.
- Réversion : `PATCH /api/ai-lab/policy` avec `killSwitchEngaged:false` et step-up frais.
- Non testé en conditions de production réelles (voir 08, 12, 16 §2.9) — seule la logique `policyEngine.test.ts` est vérifiée.

## 3. Ce qui manque structurellement pour une vraie posture de DR (voir aussi 13/14 P0.3)

- Aucun exercice de restauration de sauvegarde documenté ou chronométré (RTO/RPO non mesurés).
- Aucune stratégie multi-région ou multi-hébergeur.
- Aucun runbook de rotation de secrets testé en pratique.
- Aucun test de panne forcée pour un fournisseur externe autre que la base de données elle-même.

Ce dernier point constitue l'écart principal entre "résilience prouvée" (coupure DB courte, réellement testée) et "disaster recovery" au sens complet du terme (non atteint à ce jour) — la distinction est intentionnellement maintenue tout au long de ce dossier (voir 13-ULTIMATE-GAP-ANALYSIS.md, ligne "Résilience infra").
