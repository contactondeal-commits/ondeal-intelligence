# 14 — Roadmap post-Phase 5

Chaque chantier : `objectif → architecture → dépendances → risques → tests → critères d'acceptation`.

## P0 — Indispensable production/sécurité

### P0.1 — Politique de rétention des données AI Lab
- **Objectif** : purge automatique de `MemoryRecord` expiré, TTL explicite pour `AiLabAttachment`.
- **Architecture** : un job cron (`/api/cron/*`) qui `deleteMany` les `MemoryRecord` où `expiresAt < now()`, et supprime les fichiers `/tmp` + lignes `AiLabAttachment` au-delà d'un TTL configurable.
- **Dépendances** : décision Owner sur la durée de rétention.
- **Risques** : suppression prématurée d'une mémoire encore utile — prévoir un TTL généreux par défaut.
- **Tests** : test unitaire du job, vérification qu'une ligne non expirée n'est jamais supprimée.
- **Critères d'acceptation** : test vert + exécution réelle en staging confirmant la suppression effective.

### P0.2 — Rollback pour mutations marchandes réelles
- **Objectif** : pouvoir annuler une mise à jour de stock/statut produit réellement exécutée.
- **Architecture** : journal de mutation (avant/après) par `ActionItem`, fonction `reverseAction()` par type.
- **Dépendances** : aucune externe.
- **Risques** : une annulation tardive peut entrer en conflit avec un changement Shopify entretemps — nécessite une vérification d'état avant reverse.
- **Tests** : reverse d'une mutation stock testé contre une vraie base + vrai mock Shopify.
- **Critères d'acceptation** : test d'un cycle complet update→reverse→état identique à l'origine.

### P0.3 — Disaster recovery documenté et testé (voir 18)
- **Objectif** : procédure de reprise après incident majeur (pas seulement panne DB courte).
- **Critères d'acceptation** : voir 18-DISASTER-RECOVERY.md.

## P1 — Autonomie agentique supérieure

### P1.1 — Différenciation réelle des niveaux d'autonomie
- **Objectif** : `AUTONOMOUS`/`DEEP`/`ULTIMATE` doivent réellement différer (profondeur de vérification, tolérance de risque, budget par défaut).
- **Architecture** : étendre `evaluatePolicy()` avec une branche par niveau, pas seulement ASSIST vs. reste.
- **Risques** : complexifier la matrice de décision sans introduire de trou de sécurité — chaque nouvelle branche doit rester testée exhaustivement comme `policyEngine.test.ts` le fait aujourd'hui.
- **Tests** : étendre `policyEngine.test.ts` pour chaque niveau.
- **Critères d'acceptation** : 4 comportements distincts et testés, jamais 2 niveaux identiques sans le documenter explicitement.

### P1.2 — Observabilité proactive
- **Objectif** : notification Owner (push/email) sur dégradation détectée, pas seulement un onglet à consulter.
- **Architecture** : cron périodique appelant `computeObservabilitySummary()`, notification si seuil dépassé.
- **Critères d'acceptation** : test d'intégration simulant une dégradation → notification envoyée.

## P2 — Intelligence / mémoire / raisonnement

### P2.1 — Mémoire sémantique (embeddings)
- **Objectif** : dépasser le rappel par mot-clé.
- **Architecture** : pipeline d'embeddings (fournisseur à choisir), recherche vectorielle (pgvector ou service dédié).
- **Risques** : coût, latence, exactitude du rappel.
- **Critères d'acceptation** : comparaison mesurée mot-clé vs. sémantique sur un corpus de test réel.

### P2.2 — Vérification/critique universelle
- **Objectif** : généraliser le pattern critic/judge (aujourd'hui limité à coder_implementation) à tous les rôles.
- **Critères d'acceptation** : chaque rôle spécialiste produit une évaluation indépendante avant validation finale, testée.

## P3 — Connecteurs et capacité d'action

- Prioriser par valeur business déclarée par l'Owner parmi les ~22-28 connecteurs architecture-only (voir 11-CONNECTORS.md) — chacun nécessite une décision Owner (app OAuth2 ou clé API), pas un chantier de code pur.
- Compléter les tests manquants sur Judge.me et Google Analytics (implémentation réelle, jamais testée).

## P4 — Self-improvement contrôlé

### P4.1 — Auto-ship à faible risque
- **Objectif** : permettre l'auto-approbation pour des changements strictement classifiés comme sans risque (ex. correctif de typo, ajout de test), toujours sous kill switch et journalisation intégrale.
- **Risques** : élevé — nécessite une classification de risque fiable avant toute automatisation de l'approbation. Ne jamais retirer l'obligation de step-up pour un changement touchant la sécurité, l'authentification, ou une mutation de donnée.
- **Critères d'acceptation** : classification testée sur un corpus de PRs historiques, taux de faux négatif nul sur les changements sensibles avant toute activation.

## P5 — Scale / SaaS / enterprise

- Invitations d'équipe (bloqué sur fournisseur d'email — décision Owner).
- API publique marchande (conception à faire avant tout code).
- Pages Suppliers/Reports/Agency Workspace (décision de priorisation Owner).
- Correction de l'incohérence documentaire `prisma/seed.ts` (paiement).

Chaque chantier ci-dessus reste, à ce stade, une proposition de roadmap — aucun n'est déclaré construit dans ce dossier tant qu'il n'a pas de preuve dans 05-CAPABILITY-MATRIX.md ou 16-FINAL-ACCEPTANCE-MATRIX.md.
