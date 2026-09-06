# 13 — Écart vers l'ambition ultime

Ambition déclarée : un système e-commerce autonome, agentique, multimodal, capable d'observer, raisonner, planifier, agir, vérifier, apprendre et s'améliorer sous contrôle du Platform Owner.

`Capability actuelle | Niveau réel | Niveau cible | Gap | Difficulté | Risque | Priorité | Prochaine construction`

| Capability | Niveau réel | Niveau cible | Gap | Difficulté | Risque | Priorité | Prochaine construction |
|---|---|---|---|---|---|---|---|
| Planification multi-étapes | Réelle, un seul appel LLM de planification, re-plan sur instruction Owner | Planification récursive, re-planification continue par le système lui-même | Modéré | Moyenne | Faible | P2 | Boucle de re-planification périodique sans intervention Owner |
| Vérification/critique post-action | Réelle pour coder_implementation uniquement | Juge indépendant systématique pour tout rôle | Important | Moyenne | Moyen (faux positifs) | P2 | Généraliser le pattern critic/judge à tous les rôles spécialistes |
| Niveaux d'autonomie différenciés | Code identique au-delà d'ASSIST | Comportement réellement distinct par niveau (profondeur de vérification, budget, tolérance au risque) | Important | Moyenne | Faible | P1 | Implémenter une vraie branche de policy par niveau |
| Mémoire | Mécanique, mot-clé | Sémantique (embeddings), récupération contextuelle | Important | Élevée | Faible | P2 | Pipeline d'embeddings + recherche vectorielle |
| Rollback / réversibilité | Absent | Undo automatique pour toute mutation marchande réelle | Important | Élevée | Élevé (données réelles) | P0 | Journal de mutation + fonction reverse par type d'action |
| Rétention/suppression données AI Lab | Absente | Politique explicite, appliquée par cron | Important | Faible | Élevé (RGPD) | P0 | Cron de purge `MemoryRecord`/`AiLabAttachment` selon `expiresAt` |
| Auto-amélioration (Evolution) | Réelle mais 100% supervisée (approbation humaine obligatoire) | Auto-amélioration bornée par policy, pas par une approbation manuelle systématique pour les changements à faible risque | Modéré | Élevée | Élevé (sécurité) | P4 | Catégorisation de risque des propositions, auto-ship pour risque nul uniquement, sous kill switch renforcé |
| Multimodalité | Génération d'image réelle (texte→image) ; vision utilisée en interne pour la revue d'écran du Coder Agent | Compréhension d'image en entrée pour les missions marchandes (ex. analyse visuelle de fiche produit) | Modéré | Moyenne | Faible | P2 | Vision Tool pour AiLabAttachment de type IMAGE |
| Connecteurs d'action réels | 3 (GitHub, Klaviyo, Windsor.ai) + 4 marchands | Large éventail d'actions réelles sur systèmes tiers | Important | Variable (par connecteur) | Moyen (chaque nouvelle écriture externe) | P3 | Prioriser par valeur business : Google Ads, Meta Ads, Slack |
| Observabilité | Réelle, 24h, seuils fixes | Alerting proactif (push/email), tableaux de bord historiques | Modéré | Faible | Faible | P1 | Notification Owner sur dégradation détectée |
| Résilience infra | Réelle, prouvée (panne DB survivable) | Résilience multi-région, disaster recovery documenté et testé | Modéré | Élevée | Élevé | P0/P1 | Voir 18-DISASTER-RECOVERY.md |
| Merchant Plane SaaS | Réel, 4 plans, entitlements enforced sur 2/3 axes | Invitations d'équipe, API publique, Suppliers/Reports/Agency Workspace construits | Important | Variable | Faible (produit) | P5 | Voir 10-MERCHANT-SAAS.md |
| Sécurité Owner | Réelle, WebAuthn complet, step-up, kill switch | Identique — déjà au niveau visé pour cette phase | Faible | — | — | P0 (maintien) | Compléter la checklist Owner E2E restante (voir 15) |

## Ce qui existe aujourd'hui vs. la roadmap future

**Existe aujourd'hui** : orchestration multi-agent réelle avec budgets/timeouts/pause-reprise, sécurité Owner de niveau production (WebAuthn, step-up, kill switch, révocation), auto-amélioration réelle mais entièrement supervisée, observabilité et ROI réels, Merchant Plane SaaS fonctionnel avec entitlements partiellement enforced.

**Constitue la roadmap future, pas l'état actuel** : différenciation réelle des niveaux d'autonomie, mémoire sémantique, vérification universelle post-action, rollback marchand, rétention de données automatisée, disaster recovery multi-région, auto-amélioration à faible supervision pour les changements sans risque, expansion des connecteurs d'action, complétion du Merchant Plane (invitations, API publique, pages vendues non construites).

Aucune de ces deux listes n'est mélangée dans le reste de ce dossier.
