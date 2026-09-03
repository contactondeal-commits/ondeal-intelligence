# Modèle SaaS

## Hiérarchie

```
Utilisateur → Organisation → Boutique → Données → Intelligence
```

Une organisation peut posséder plusieurs boutiques (selon son plan) et plusieurs utilisateurs (rôles
`OWNER`/`ADMIN`/`ANALYST`/`VIEWER`). OnDeal.fr est la première boutique pilote, créée exactement comme le
serait celle de n'importe quel autre e-commerçant — rien dans le code ne la traite différemment.

## Offre commerciale (définie par l'utilisateur)

| Plan | Prix | Contenu |
|---|---|---|
| 🟢 Starter | 19 €/mois | 1 boutique, analyse catalogue, avis, stock, alertes, recommandations |
| 🔵 Pro | 49 €/mois | Tout Starter + intelligence prix/marge, marketing, IA, automatisations, rapports |
| 🟣 Business | 99 €/mois | Tout Pro + plusieurs boutiques, fournisseurs, automatisations avancées, API, rapports avancés, historique, équipe |
| 🏢 Agency | Sur devis | Pour les agences gérant plusieurs boutiques clientes |

Implémenté dans `prisma/seed.ts` (`PlanLimit` : `maxStores`/`maxProducts`/`maxUsers` par plan) et
`src/lib/plan-limits.ts` (`PLAN_FEATURES` : quelles fonctionnalités chaque plan débloque, appliqué
concrètement dans `AppShell` — les liens de navigation vers Pricing/Marketing/Assistant sont désactivés en
dessous du plan Pro, pas seulement documentés).

## Ce qui est réellement appliqué dans cette V1

- Limites de nombre de boutiques/utilisateurs par plan : **appliquées** côté serveur (`canCreateStore`,
  `canAddMember`) — pas seulement affichées.
- Fonctionnalités par plan (`hasFeature`) : **appliquées** dans la navigation (liens désactivés) — mais
  **pas encore** au niveau des routes API elles-mêmes (ex. rien n'empêche aujourd'hui un appel direct à
  `/api/marketing/generate` depuis un plan Starter). C'est une lacune connue, listée dans le rapport de
  livraison — le contrôle applicatif est présent au niveau du modèle et de l'UI, pas encore répliqué en
  garde-fou serveur systématique sur chaque route.
- **Paiement** : non implémenté (aucun fournisseur de paiement connecté — Stripe ou équivalent serait
  nécessaire, avec des identifiants que nous n'avons pas dans cet environnement). Le plan d'une organisation
  est actuellement modifiable uniquement en base (ou via un futur écran d'administration) — le modèle de
  données est prêt pour qu'un webhook Stripe mette simplement à jour `Organization.plan`.

## Isolation des données

Voir `SECURITY.md` — chaque requête est bornée à `storeId` via `requireStoreAccess`, elle-même bornée à
l'organisation de l'utilisateur via `Membership`. Aucune donnée d'une organisation n'est jamais visible par
une autre.
