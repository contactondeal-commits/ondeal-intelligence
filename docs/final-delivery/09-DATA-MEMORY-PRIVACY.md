# 09 — Données, mémoire, vie privée

## Données stockées liées à l'IA

| Modèle | Contenu | Risque PII | Rétention/suppression |
|---|---|---|---|
| `ModelEvalRun`/`ModelEvalResult` | jeu de tâches synthétique, échantillon de sortie tronqué | Aucun (documenté comme "jamais une donnée client") | Aucune trouvée |
| `CoderMission*` | but, étapes, artefacts (chemin disque) | Aucun — n'a pas de `storeId`, n'agit jamais sur une boutique cliente | Fichiers workspace réapés opportunément (`reapStaleWorkspaces`), jamais par cron planifié |
| `StorefrontMission*` | but, contraintes, world state, résultats de nœuds | `storeId` optionnel présent en schéma, mais `buildWorldState()` ne lit aujourd'hui **aucune** table boutique (Product/Order/Recommendation) — aucune PII client ne transite actuellement malgré le champ | Aucune trouvée |
| `AiLabAttachment` | fichier uploadé par l'Owner, texte extrait (tronqué à 20 000 caractères) | **Oui, possible** — un fichier CSV/PDF uploadé par l'Owner peut contenir des données clients ; le texte extrait est injecté tel quel dans le prompt du planificateur | **Aucune suppression automatique.** Fichiers sur `/tmp` (éphémère conteneur), lignes en base jamais purgées — gap ouvert |
| `AiLabAuditLog` | acteur, action, décision, coût, statut, `reason` libre | `reason` jamais censé contenir un secret (contrat documenté, pas vérifié mécaniquement) | Append-only par convention, jamais supprimé |
| `MemoryRecord` | contenu mémoire libre, `expiresAt` | Faible en pratique aujourd'hui (voir StorefrontMission ci-dessus) mais le champ existe pour l'avenir | `expiresAt` **filtré à la lecture seulement** — aucune ligne expirée n'est jamais réellement supprimée. Le schéma lui-même signale "à revoir après relecture RGPD" |
| `ExperimentRun`/`ExperimentVariant` | sortie brute du modèle par variante | Faible (dépend de l'objectif testé) | Aucune trouvée |
| `EvolutionProposal` | hypothèse, note de revue, URL/branche de PR livrée | Aucun (code, pas donnée client) | Aucune trouvée |

**Constat central** : aucune politique de rétention/suppression automatique n'existe pour une seule table AI Lab. C'est un point RGPD ouvert, à traiter explicitement (voir 14-POST-PHASE-5-ROADMAP.md, P0).

## Données envoyées aux modèles IA

- Le texte extrait des pièces jointes (`AiLabAttachment.extractedText`, tronqué à 1500 caractères par fichier dans le résumé) est injecté directement dans le prompt système/utilisateur envoyé au fournisseur IA configuré (Anthropic par défaut).
- Les notes de mémoire pertinentes (`MemoryRecord`, scope FAILURE/OUTCOME) sont également injectées dans le prompt de planification.
- Aucune anonymisation/scrubbing de PII n'est appliqué avant envoi — responsabilité actuellement portée par l'absence de données clients dans le world state (voir ci-dessus), pas par un filtre actif.

## Isolation entre boutiques

Vérifiée par lecture de code (`requireStoreAccess`, `src/lib/auth.ts`) et par test réel (red-team, IDOR 403) : le `storeId` fourni par le client n'est jamais fait confiance seul — toujours vérifié contre une `Membership` réelle en base, puis réutilisé comme filtre Prisma supplémentaire sur chaque requête de donnée (produit, stock, etc.).

## Mémoire utilisateur/agent

Mécanique (rappel par mot-clé), jamais une recherche sémantique par embeddings — documenté explicitement en code. Une mémoire concernant prix/stock/marge doit toujours être réconciliée contre le moteur déterministe avant affichage — jamais présentée seule comme source de vérité.

## Suppression de compte

`POST /api/account/delete` (lu intégralement) : mot de passe re-vérifié, confirmation littérale `"SUPPRIMER"` exigée. Si l'utilisateur est seul membre de son organisation → suppression complète en cascade (Stores, Integrations, Products, Orders...). Si d'autres membres existent → seule sa Membership disparaît, les données de l'organisation restent. **Ne touche jamais les tables AI Lab** (relations `onDelete: SetNull`, pas `Cascade` depuis `Store`) — une suppression de boutique laisse les lignes AI Lab orphelines (storeId nul) plutôt que de les supprimer.

## Export de compte

`GET /api/account/export` (lu intégralement) : exporte le profil, les boutiques possédées, produits/hypothèses de coût/actions (plafonnés à 2000 lignes chacun, jamais tronqués silencieusement — un indicateur `truncated` est renvoyé), les entrées d'audit personnelles. **Exclut explicitement** les identifiants d'intégration chiffrés. **N'exporte jamais** les données AI Lab (Memory/Missions/Audit AI Lab), même pour un compte Platform Owner.

## Secrets

Aucun secret en clair trouvé dans le code source, les migrations, ou les fichiers de configuration versionnés (recherche par motif de clé API et par assignation littérale). `.env` local non versionné, ne contient que des valeurs de développement.

## Pièces jointes — limites techniques

Types supportés : PDF, DOCX, XLSX, CSV, JSON, TXT, MD (parsés en texte). Images classifiées mais jamais parsées ici (traitées séparément par un futur Vision Tool). Taille maximale : 20 Mo, refusée sinon (jamais tronquée silencieusement).

## Points nécessitant une décision RGPD/sécurité explicite

1. **Politique de rétention AI Lab absente** — `MemoryRecord.expiresAt` non purgé, `AiLabAttachment` jamais nettoyé, `AiLabAuditLog` append-only indéfiniment.
2. **Pièces jointes potentiellement porteuses de PII** injectées dans un prompt LLM sans scrubbing — acceptable tant que le world state ne lit pas de données clients, mais à re-vérifier si `buildWorldState` évolue pour ingérer des données boutique réelles.
3. **Stockage des pièces jointes sur `/tmp` conteneur** — pas un stockage persistant/chiffré dédié ; à migrer vers un stockage objet si le volume ou la sensibilité augmente.
4. Aucune de ces décisions n'a été prise unilatéralement dans ce dossier — elles sont signalées pour arbitrage Owner.
