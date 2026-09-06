# 02 — Cartographie complète de l'AI Lab

14 onglets réels dans `src/app/ai-lab/AiLabConsole.tsx` (`type Tab`, ligne 18) : Composer, Missions, Tools, Connectors, Models, Agents, Memory, Experiments, Evolution, Images, Outcomes, Observability, **Owner Control Center** (id interne `policy`), Audit. Chaque route API sous `src/app/api/ai-lab/**` est appelée par exactement un de ces onglets (ou par `src/app/owner-auth/page.tsx` pour les routes `owner/*`) — aucune route orpheline, aucun onglet appelant une route inexistante (vérifié par recoupement exhaustif).

Trois primitives de gate utilisées partout (`src/lib/authz/capabilities.ts`) :
- `requireCapability(cap)` — allowlist Platform Owner uniquement.
- `requireCapabilityWithOwnerSession(cap)` — allowlist + session WebAuthn vivante.
- `requireCapabilityWithStepUp(cap)` — allowlist + session + ré-élévation WebAuthn <5 min.

---

## 1. Composer
- **Objectif** : intake d'objectif en langage naturel, décomposé en graphe par le Supervisor.
- **Fichiers** : `AiLabConsole.tsx:245-393`, `src/lib/ai/attachments/{store,parse}.ts`.
- **Routes** : `POST /api/ai-lab/attachments`, `POST /api/ai-lab/missions`, `POST /api/ai-lab/missions/[id]/run`.
- **Données** : `StorefrontMission`, `AiLabAttachment`.
- **Gate** : `requireCapability("SYSTEM_CODER")`.
- **Tests** : aucun test direct de la route ; le moteur d'exécution sous-jacent (`runStorefrontMission`) est couvert par `tests/supervisorGraphRunner.test.ts`.
- **Limite documentée** : mur d'exécution serverless — une mission avec `coder_implementation` peut nécessiter `scripts/run-ai-lab-mission.ts` pour aller au bout.

## 2. Missions
- **Objectif** : cycle de vie complet d'une mission (liste, détail, annulation, reprise, instruction, dispatch, SSE temps réel).
- **Fichiers** : `AiLabConsole.tsx` (`MissionsTab`), `src/lib/ai/supervisor/{graphRunner,graphStore,missionDetail,worldState,specialists,catalogue}.ts`.
- **Routes** : `GET /api/ai-lab/missions`, `[id]`, `[id]/run`, `[id]/cancel`, `[id]/instruction` (owner session), `[id]/dispatch` (step-up), `[id]/stream` (SSE).
- **Données** : `StorefrontMission`, `StorefrontMissionNode`, `StorefrontMissionArtifact`, `AiLabAuditLog`.
- **Tests** : `tests/missionStreamRoute.test.ts` (SSE 403/erreur/clôture/diff réel), `tests/supervisorGraphRunner.test.ts` (pipeline complet, cascade PRUNE, annulation coopérative, rôle inconnu → échec explicite). Aucun test direct sur `missions/route.ts`, `[id]/cancel`, `[id]/instruction`, `[id]/dispatch`.
- **Limite documentée** : la pause (`PAUSED`) sur budget/wall-clock/kill-switch est vérifiée à chaque itération, jamais seulement au démarrage.

## 3. Tools
- **Objectif** : Tool Registry avec health check réel (§NO CAPABILITY THEATER — jamais un statut codé en dur).
- **Fichiers** : `src/lib/ai/tools/registry.ts` (13 outils : web_research, deep_research, repository_inspect, sandbox_coder_implementation, data_analysis, store_data, shopify_data, ga4_data, judgeme_data, cj_dropshipping_data, file_intelligence, mission_history, create_image).
- **Route** : `GET /api/ai-lab/tools`.
- **Gate** : `requireCapability("SYSTEM_CODER")`.
- **Tests** : aucun test dédié trouvé.
- **Limite documentée** : registre statique, pas de chargement dynamique de plugin.

## 4. Connectors
- **Objectif** : Connector Hub distinguant réellement connecté vs. architecture-only (§NO FAKE CONNECTOR).
- **Fichiers** : `src/lib/ai/connectors/registry.ts`, clients réels `github.ts`, `klaviyo.ts`, `windsor.ts`.
- **Routes** : `GET /api/ai-lab/connectors`, `POST .../github/connect|disconnect|test`.
- **Données** : `PlatformIntegration` (connecteurs Control Plane), `Integration` (connecteurs Merchant Plane réutilisés en lecture).
- **Gate** : lecture `requireCapability`, connect/disconnect `requireCapabilityWithStepUp`.
- **Tests** : `tests/connectorRegistryKlaviyo.test.ts`, `connectorRegistryWindsor.test.ts`, `klaviyoConnector.test.ts`, `windsorConnector.test.ts` couvrent les clients ; aucun test direct sur les routes `/api/ai-lab/connectors*`.
- **Inventaire complet** : voir 11-CONNECTORS.md.

## 5. Models
- **Objectif** : console Model Router avec override runtime immédiat (pas lecture seule).
- **Fichiers** : `src/lib/ai/models/{registry,router,evaluation,cost,tasks}.ts`.
- **Routes** : `GET /api/ai-lab/models`, `GET/POST .../models/config` (POST = step-up, `AI_MODEL_ADMIN`).
- **Données** : `ModelConfig`, `ModelEvalRun`, `ModelEvalResult`.
- **Tests** : `modelRouter.test.ts`, `modelEvaluation.test.ts`, `resolveFailoverCandidates.test.ts`, `failoverProvider.test.ts`, `costs.test.ts`. Aucun test direct sur les routes.
- **Limite documentée** : `providerHealth` rempli uniquement pour OpenAI aujourd'hui.

## 6. Agents
- **Objectif** : Dynamic Agent Registry — stats réelles agrégées depuis l'audit, plus contrôle Owner (activer/désactiver un rôle).
- **Fichiers** : `src/lib/ai/agents/registry.ts`.
- **Routes** : `GET /api/ai-lab/agents` (owner session), `POST .../agents/config` (step-up, `AI_MODEL_ADMIN`).
- **Données** : `StorefrontMissionNode`, `AgentRoleConfig`.
- **Tests** : aucun test dédié direct (couverture indirecte via `evolutionProposals.test.ts`).
- **Limite documentée** : pas de forçage de provider/modèle par rôle — champ volontairement absent tant qu'aucun effecteur réel n'existe.

## 7. Memory
- **Objectif** : mémoire persistante, rappel mécanique par mot-clé — explicitement PAS une recherche sémantique par embeddings.
- **Fichiers** : `src/lib/ai/memory/store.ts` (`writeMemory`, `queryMemory`, `recentRelevantMemories`).
- **Route** : `GET /api/ai-lab/memory` (owner session).
- **Données** : `MemoryRecord` (scopes WORKING/EPISODIC/BRAND/DESIGN/ENGINEERING/FAILURE/OUTCOME/MODEL_PERFORMANCE).
- **Tests** : aucun test dédié trouvé.
- **Limite documentée (schéma)** : aucune mémoire n'est une source de vérité pour prix/stock/marge — toujours réconciliée contre le moteur déterministe. `expiresAt` filtré à la lecture, jamais purgé (voir 09).

## 8. Experiments
- **Objectif** : compare ≥2 configurations réelles (modèle/prompt/stratégie/agent) sur le même objectif, jugées indépendamment — sans masquage par failover.
- **Fichiers** : `src/lib/ai/experiments/run.ts` (`EXPERIMENT_DIMENSIONS = MODEL/PROMPT/STRATEGY/AGENT`).
- **Routes** : `GET/POST /api/ai-lab/experiments`, `GET .../experiments/[id]`.
- **Données** : `ExperimentRun`, `ExperimentVariant`.
- **Tests** : `tests/experimentRun.test.ts` — refuse <2 variantes, refuse labels dupliqués, appelle chaque provider réellement, échec honnête sans repli caché.
- **Limite documentée** : un échec de provider reste un résultat honnête (score absent), jamais secouru par failover.

## 9. Evolution
- **Objectif** : pipeline complet d'auto-amélioration (signal → hypothèse → vraie CoderMission → revue Owner → approbation/rejet → PR réelle), structurellement incapable de s'auto-approuver.
- **Fichiers** : `src/lib/ai/evolution/{proposals,ship}.ts`.
- **Routes** : `detect`, `proposals` (GET/POST), `proposals/[id]` (GET), `proposals/[id]/launch` (owner session), `/review` et `/ship` (step-up).
- **Données** : `EvolutionProposal`, `CoderMission` (réutilisé).
- **Tests** : `evolutionProposals.test.ts`, `evolutionShip.test.ts` — création de branche réelle, écriture/suppression exacte des fichiers modifiés, ouverture de PR réelle, jamais de PR vide fabriquée.
- **Preuve structurelle** : `shipProposal`/`shipMissionAsPullRequest` ne sont appelés que depuis la route `ship` step-up-gated — jamais depuis un fichier `supervisor/*.ts` (vérifiable par grep).

## 10. Images
- **Objectif** : génération d'image réelle (OpenAI dall-e-3), premier appelant réel du Tool Registry `create_image`.
- **Fichiers** : `src/lib/ai/providers/imageGeneration.ts`.
- **Route** : `POST /api/ai-lab/images` (owner session).
- **Tests** : `imagesRoute.test.ts`, `imageGeneration.test.ts` — coût exact par taille×qualité, échec honnête (400 + audit FAILURE) sans jamais fabriquer une image.
- **Limite documentée** : aucune persistance Prisma de l'image elle-même — seule la provenance (prompt/coût/modèle) est journalisée dans `AiLabAuditLog`.

## 11. Outcomes
- **Objectif** : vue business/ROI calculée à la volée depuis les tables existantes — jamais un chiffre en dur.
- **Fichiers** : `src/lib/ai/outcomes/engine.ts` (`computeOutcomeSummary`).
- **Route** : `GET /api/ai-lab/outcomes` (owner session).
- **Tests** : `outcomeEngine.test.ts` — dénominateur nul renvoie `null`, jamais un taux fabriqué ; `outcomesRoute.test.ts` — 403 sans calcul si refusé.
- **Limite documentée** : missions PLANNING/RUNNING/PAUSED exclues du dénominateur du taux de succès.

## 12. Observability
- **Objectif** : santé opérationnelle 24h, distincte d'Outcomes (valeur business) et d'Audit (journal chronologique).
- **Fichiers** : `src/lib/observability/{engine,health}.ts`.
- **Route** : `GET /api/ai-lab/observability` (owner session).
- **Tests** : `observabilityEngine.test.ts`, `observabilityRoute.test.ts`.
- **Seuils fixes (code)** : fenêtre 24h, synchro obsolète >48h, mission bloquée >2h — non configurables depuis l'UI.

## 13. Owner Control Center (onglet `policy`)
- **Objectif** : souveraineté Owner — Policy Engine global (autonomie par défaut, budget dur, autorisation d'effets production, kill switch) + gestion des sessions WebAuthn.
- **Fichiers** : `src/lib/ai/policy/engine.ts`, `src/lib/authz/ownerSession.ts`.
- **Routes** : `GET/PATCH /api/ai-lab/policy` (PATCH = step-up), `GET /api/owner/sessions`, `POST /api/owner/sessions/[id]/revoke` (step-up).
- **Données** : `SystemPolicy` (singleton), `PlatformOwnerSession`, `PlatformOwnerCredential`, `PlatformOwnerRecoveryCode`.
- **Tests** : `policyEngine.test.ts` — matrice de décision complète (voir 04-OWNER-SECURITY.md). Aucun test direct sur les routes `/api/ai-lab/policy` ou `/api/owner/sessions*`.

## 14. Audit
- **Objectif** : journal d'audit global append-only.
- **Fichiers** : `src/lib/ai/policy/audit.ts` (`appendAuditLog`, `listAuditLogs`).
- **Route** : `GET /api/ai-lab/audit` (`missionId` optionnel, `take: 200`).
- **Données** : `AiLabAuditLog`.
- **Tests** : aucun test dédié trouvé.
- **Limite documentée** : append-only par convention de code (aucune fonction update/delete exportée), pas une contrainte de base de données.

---

## Boucle Supervisor — nom exact vs. code réel

La séquence "OBSERVE→UNDERSTAND→REASON→PLAN→DELEGATE→ACT→VERIFY→LEARN" **n'apparaît nulle part dans le dépôt** (grep confirmé, zéro occurrence). Le code réel (`src/lib/ai/supervisor/graphRunner.ts`) implémente : `buildWorldState` → `planInitialGraph`/`planNodesForInstruction` (appel LLM réel) → `partitionRunnable`/`claimNode`/`dispatchSpecialist` (exécution parallèle) → (pour `coder_implementation` uniquement) lecture de `verify_and_fix`/critic → `writeMemory` (FAILURE/OUTCOME). Détail complet en 03-AGENTIC-AUTONOMY.md.
