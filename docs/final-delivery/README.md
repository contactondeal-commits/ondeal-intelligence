# OnDeal Intelligence / AI Lab Ultimate — Dossier de livraison finale

**Date de constitution : 06/09/2026. HEAD Git au moment de la rédaction : `fc3b3b36cd49638b97ae7d97182a6b4bf9987b22` (branche `master`), confirmé identique au commit servi en production (`https://intelligence.ondeal.fr/api/health`).**

Ce dossier est la vérité technique complète du système OnDeal Intelligence / AI Lab Ultimate, destinée à permettre à un ingénieur qui ne connaît pas l'historique du projet de reprendre son exploitation, sa sécurisation et son développement. Il est construit exclusivement à partir d'une inspection réelle du dépôt (Git, code, schéma Prisma, routes API), de l'exécution réelle des suites de tests disponibles, et d'une vérification directe de la production — jamais d'une supposition ou d'un résumé d'intention.

Aucune capacité n'est déclarée fonctionnelle sur la seule base de l'existence d'un fichier, d'une route ou d'un composant d'interface. Chaque affirmation porte une preuve (commande exécutée, fichier:ligne, résultat de test, réponse HTTP réelle).

## Index des documents

| # | Document | Contenu |
|---|---|---|
| 00 | [EXECUTIVE-SUMMARY](./00-EXECUTIVE-SUMMARY.md) | Synthèse pour un lecteur pressé — état réel, chiffres clés, ce qui marche, ce qui ne marche pas |
| 01 | [SYSTEM-ARCHITECTURE](./01-SYSTEM-ARCHITECTURE.md) | Cartographie technique complète, flux Merchant/Owner, diagrammes Mermaid |
| 02 | [AI-LAB-ARCHITECTURE](./02-AI-LAB-ARCHITECTURE.md) | Les 14 modules AI Lab, un par un, avec preuves |
| 03 | [AGENTIC-AUTONOMY](./03-AGENTIC-AUTONOMY.md) | La boucle agentique réelle, les niveaux d'autonomie, ce qui existe vs. ce qui est nommé |
| 04 | [OWNER-SECURITY](./04-OWNER-SECURITY.md) | Chaîne de sécurité Platform Owner complète, WebAuthn, Policy Engine, kill switch |
| 05 | [CAPABILITY-MATRIX](./05-CAPABILITY-MATRIX.md) | Matrice exhaustive de toutes les capacités avec statut et preuve |
| 06 | [TEST-EVIDENCE](./06-TEST-EVIDENCE.md) | Résultats réels de chaque suite exécutée le 06/09/2026 |
| 07 | [PRODUCTION-VERIFICATION](./07-PRODUCTION-VERIFICATION.md) | Vérification production réelle, SHA déployé vs. attendu |
| 08 | [RED-TEAM-FAILURE-MATRIX](./08-RED-TEAM-FAILURE-MATRIX.md) | Scénarios adverses et de panne, comportement attendu vs. réel |
| 09 | [DATA-MEMORY-PRIVACY](./09-DATA-MEMORY-PRIVACY.md) | Données stockées, isolation, rétention, points RGPD ouverts |
| 10 | [MERCHANT-SAAS](./10-MERCHANT-SAAS.md) | Plans, entitlements, limites, readiness SaaS réelle |
| 11 | [CONNECTORS](./11-CONNECTORS.md) | Inventaire exact des connecteurs par catégorie |
| 12 | [TECHNICAL-DEBT](./12-TECHNICAL-DEBT.md) | Dette technique trouvée activement, classifiée |
| 13 | [ULTIMATE-GAP-ANALYSIS](./13-ULTIMATE-GAP-ANALYSIS.md) | Écart entre l'état actuel et l'ambition long terme |
| 14 | [POST-PHASE-5-ROADMAP](./14-POST-PHASE-5-ROADMAP.md) | Chantiers futurs priorisés P0→P5 |
| 15 | [OWNER-ACCEPTANCE-PROTOCOL](./15-OWNER-ACCEPTANCE-PROTOCOL.md) | Protocole de la première mission Owner réelle (sandbox) |
| 16 | [FINAL-ACCEPTANCE-MATRIX](./16-FINAL-ACCEPTANCE-MATRIX.md) | Matrice finale stricte, une preuve par ligne |
| 17 | [OPERATIONS-RUNBOOK](./17-OPERATIONS-RUNBOOK.md) | Comment exploiter le système au quotidien |
| 18 | [DISASTER-RECOVERY](./18-DISASTER-RECOVERY.md) | Comportement de panne réel et procédures de reprise |
| 19 | [CHANGELOG-AND-GIT-EVIDENCE](./19-CHANGELOG-AND-GIT-EVIDENCE.md) | Historique Git réel, phase par phase |

## Documents existants consolidés, pas dupliqués

Le dépôt contient déjà `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/SAAS.md`, `docs/INTEGRATIONS.md`, `docs/DEPLOYMENT.md`, `docs/ENVIRONMENT.md`, `docs/SETUP.md`. Ce dossier ne les recopie pas : il les référence et les complète là où l'inspection réelle a trouvé des écarts (notamment `docs/SAAS.md` contient une phrase obsolète sur le paiement — signalé en §10).

## Comment lire ce dossier

Un statut n'est jamais vert par supposition. Le rubric utilisé partout :
`✅ VERIFIED` · `🟢 OWNER VERIFIED` · `🟡 PARTIAL` · `🟠 EXTERNAL DEPENDENCY` · `🔴 FAILED` · `⚪ NOT IMPLEMENTED`.
