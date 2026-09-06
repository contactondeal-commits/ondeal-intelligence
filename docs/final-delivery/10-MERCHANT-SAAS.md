# 10 — Dossier Business / SaaS (Merchant Plane)

## Plans et limites réelles (`prisma/seed.ts`)

| Plan | maxStores | maxProducts | maxUsers | Prix (commentaire seed) |
|---|---|---|---|---|
| STARTER | 1 | 1 000 | 1 | 19 €/mois |
| PRO | 1 | 10 000 | 3 | 49 €/mois |
| BUSINESS | 10 | 100 000 | 15 | 99 €/mois |
| AGENCY | 100 | 1 000 000 | 100 | non chiffré dans le commentaire seed |

## Entitlements — état réel par fonctionnalité

`PLAN_FEATURES` (`src/lib/plan-limits.ts`) déclare, par plan : STARTER (dashboard, stock, reviews, recommendations, alerts), PRO (+ pricing, marketing, assistant, automations, reports), BUSINESS (+ multi_store, suppliers, advanced_automations, api, audit_log, team), AGENCY (+ agency_workspace).

**Réellement appliquées côté serveur (`hasFeature()` réellement appelé dans `src/app` — vérifié par scan de code, verrouillé par `tests/planFeatureIntegrity.test.ts`)** : dashboard, stock, reviews, recommendations, alerts (baseline, jamais besoin de gate), pricing, marketing, assistant, advanced_automations, audit_log — confirmées par une mutation réelle testée (marketing/assistant refusés pour STARTER en `merchant-e2e`, 403 réel).

**Vendues mais non construites (`UNBUILT_FEATURES`)** : `automations`, `reports`, `suppliers`, `api`, `team`, `agency_workspace` — aucune page/route ne les implémente. Corrigé le 06/09/2026 : l'UI Settings affiche désormais "(bientôt)" plutôt que de les présenter comme actives à un marchand payant. **Aucun feature flag n'est présenté ici comme une fonctionnalité existante quand l'implémentation n'existe pas.**

**Appliquée par un autre mécanisme (`FEATURES_ENFORCED_BY_OTHER_MEANS`)** : `multi_store` — jamais vérifiée via `hasFeature()`, entièrement gérée par `PlanLimit.maxStores` qui rend une 2e boutique littéralement impossible à créer pour STARTER/PRO.

## Limites réellement appliquées au point d'écriture

- **`maxProducts`** : `src/lib/sync/shopifyStore.ts::storeProducts` — un nouveau produit au-delà du quota n'est jamais créé (comptabilisé `productsBlockedByPlanLimit`), les produits déjà existants continuent d'être mis à jour. Testé (4 tests).
- **`maxStores`** : `canCreateStore()`, seul point d'appel `POST /api/onboarding` — inclut le flux d'installation Shopify App Store, toujours une organisation neuve à 0 boutique, jamais un contournement.
- **`maxUsers`** : `canAddMember()` existe mais est **honnêtement inatteignable** — aucune route ne crée de `Membership` en dehors de la création du compte fondateur (signup, installation Shopify). Aucun flux d'invitation d'équipe n'existe ; Settings l'indique déjà explicitement à l'utilisateur.

## Metering

Aucun système de metering (facturation à l'usage, comptage d'appels API marchande) trouvé dans le dépôt — le modèle commercial actuel est un abonnement par palier fixe, pas un metering.

## Billing — réellement câblé

- **Stripe** (`src/app/api/webhooks/stripe/route.ts`) : signature vérifiée, filtre sur `customer.subscription.*` uniquement (ignore volontairement `checkout.session.completed` à cause du délai 3-D Secure), `Organization.plan` mis à jour uniquement sur statut actif confirmé — tout statut non actif rétrograde vers STARTER.
- **Shopify AppSubscription** (`src/app/api/webhooks/shopify/app-subscription-update/route.ts`) : HMAC vérifié, même discipline — `ACTIVE` seul active le plan, `CANCELLED/EXPIRED/FROZEN/DECLINED` rétrograde vers STARTER.
- Les routes d'initiation (`/api/billing/stripe/checkout`, `/api/billing/subscribe`) ne changent jamais le plan directement — seul le webhook fait foi.
- ⚠️ **Incohérence documentaire trouvée** : `prisma/seed.ts` contient un commentaire indiquant "Le paiement n'est pas implémenté dans cette V1" — **factuellement faux** au vu du code webhook ci-dessus, qui est réel et actif. Ce commentaire doit être corrigé dans une prochaine itération (signalé ici, non corrigé unilatéralement dans ce dossier pour rester dans le périmètre "dossier de livraison").

## Readiness SaaS — évaluation honnête

| Dimension | État |
|---|---|
| Plans/tarification | ✅ réel, seedé, 4 paliers |
| Entitlements enforced | ✅ réel pour maxProducts/maxStores, 🟡 honnêtement absent pour maxUsers (pas d'infra email) |
| Billing | ✅ réel (Stripe + Shopify), webhook comme seule source de vérité |
| Onboarding | ✅ réel (mode réel + mode démo) |
| Invitations d'équipe | ⚪ non construit — bloqué sur un fournisseur d'email |
| API publique marchande | ⚪ non construit — aucune conception |
| Metering à l'usage | ⚪ non applicable au modèle actuel |
| Intégrité de l'affichage des fonctionnalités | ✅ corrigée le 06/09/2026, verrouillée par un test qui scanne le code source réel |
