# 00 — Executive Summary

## État de référence (preuve, pas déclaration)

- **HEAD Git** : `fc3b3b36cd49638b97ae7d97182a6b4bf9987b22`, branche `master`, 45 commits au total, dépôt `github.com/contactondeal-commits/ondeal-intelligence`.
- **Production** (`https://intelligence.ondeal.fr/api/health`, interrogé le 06/09/2026 16:44 UTC) : `{"status":"ok","database":"ok","commit":"fc3b3b36cd49638b97ae7d97182a6b4bf9987b22","environment":"production"}` — **le SHA déployé est identique au HEAD attendu**.
- **89 routes API**, **68 fichiers de tests**, **538 tests unitaires/intégration** — tous exécutés réellement le 06/09/2026 (voir 06-TEST-EVIDENCE.md).
- **8 suites de validation** exécutées ce jour et toutes passées : typecheck, lint, tests unitaires, build production, e2e:smoke (27/27), merchant-e2e (14/14), red-team (3/3), forced-failure (6/6).

## Ce qui existe réellement et fonctionne (✅ / 🟢)

- Une plateforme SaaS e-commerce (Merchant Plane) avec 4 plans, entitlements réellement appliqués (`maxProducts`, `maxStores`), billing Stripe et Shopify AppSubscription réellement câblés par webhook.
- 4 connecteurs marchands totalement réels et testés (Shopify, WooCommerce, PrestaShop, CJ Dropshipping), 2 partiels (Judge.me, Google Analytics — implémentation réelle mais sans test dédié).
- Un système agentique (AI Lab Ultimate) à 14 modules : Composer, Missions, Tools, Connectors, Models, Agents, Memory, Experiments, Evolution, Images, Outcomes, Observability, Owner Control Center, Audit — chacun avec une route API réelle, un gate de capacité, et pour la majorité une couverture de tests réelle.
- Une chaîne de sécurité Platform Owner complète et réellement testée : session applicative → allowlist `PLATFORM_OWNER_USER_IDS` → session WebAuthn/FIDO2 révocable → step-up <5 min pour les actions sensibles (kill switch, ship de PR, changement de policy). **Vérifiée en conditions réelles le 06/09/2026 : le Platform Owner (contact@ondeal.fr) a réellement enregistré une passkey et accédé à `/ai-lab` en production** (voir 15-OWNER-ACCEPTANCE-PROTOCOL.md).
- Un moteur d'auto-amélioration (System Evolution) capable de produire une vraie Pull Request GitHub à partir d'un signal détecté — structurellement bloqué pour ne jamais s'auto-approuver (le ship exige `requireCapabilityWithStepUp`).
- Une observabilité et un Outcome/ROI Engine réels (jamais de taux fabriqué — dénominateur nul renvoie `null`).
- Une résilience réellement prouvée : panne Postgres réellement provoquée pendant les tests, le serveur reste vivant, `/api/health` reflète honnêtement l'état dégradé, auto-rétablissement sans redéploiement (6/6, voir 08 et 18).

## Ce qui n'existe pas ou est honnêtement incomplet (🟡 / ⚪)

- **`AUTONOMOUS`, `DEEP`, `ULTIMATE`** (niveaux d'autonomie) sont **identiques en code** — une seule branche du Policy Engine distingue `ASSIST` du reste ; ne jamais présenter ces trois niveaux comme réellement différenciés aujourd'hui.
- **Aucune politique de rétention/suppression automatique** n'existe pour les données AI Lab (MemoryRecord, AiLabAttachment, AiLabAuditLog) — point RGPD ouvert, documenté en 09.
- **6 fonctionnalités Merchant Plane vendues mais non construites** (automations, reports, suppliers, api, team, agency_workspace) — honnêtement marquées "(bientôt)" dans l'UI depuis le 06/09/2026, jamais présentées comme actives.
- **~22 connecteurs architecture-only**, chacun bloqué sur une décision Owner nommée (clé API ou app OAuth2) — jamais un défaut de code.
- **Aucun rollback/undo automatique** pour les mutations marchandes réelles (stock, statut produit) une fois exécutées côté Shopify.
- **La cérémonie Owner E2E complète (10 flux)** ne peut structurellement pas être scriptée par un agent — nécessite l'authenticateur physique de l'Owner. 3 des 10 flux ont été réellement exécutés en production le 06/09/2026 par l'Owner lui-même ; les 7 restants sont documentés en 15 et restent à exécuter.
- **Pas d'AGI/ASI** : ce système est un orchestrateur agentique à planification/exécution/vérification/mémoire réelles, mesurable et testé — aucune affirmation de conscience, de généralisation ou de raisonnement au-delà de ce que le code démontre n'est faite dans ce dossier.

## Comment utiliser ce dossier

Chaque document suivant porte ses preuves. Aucune ligne verte de la Capability Matrix (05) ou de l'Acceptance Matrix finale (16) n'est affirmée sans un test, une commande, ou une réponse HTTP réelle citée à l'appui.
