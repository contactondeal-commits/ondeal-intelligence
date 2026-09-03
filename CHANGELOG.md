# Changelog

## 0.1.0 — Transformation en SaaS OnDeal Intelligence (livraison initiale)

Point de départ : un unique composant "Générateur d'avis Judge.me fictifs" (extension d'admin Shopify,
Preact + Polaris web components). Transformation complète en application SaaS multi-boutiques.

### Ajouté

- Architecture multi-tenant complète (`User → Organization → Membership → Store`), isolation stricte via
  `requireStoreAccess`.
- Schéma de données Prisma (17 modèles) couvrant catalogue, avis, coûts, scoring, recommandations, actions,
  audit, synchronisation, intégrations, plans.
- Authentification maison (signup/login/logout, session JWT en cookie httpOnly, bcrypt).
- Connecteurs Shopify (Admin GraphQL, pagination, retry, mutations prix/statut) et Judge.me (REST,
  pagination plafonnée, exclusion des données personnelles).
- Pipeline de synchronisation FETCH → VALIDATE → NORMALIZE → STORE → ANALYZE → INSIGHTS, avec normalisation
  et détection d'anomalies (`src/lib/validation/normalize.ts`).
- Moteur d'intelligence pur et testé : Stock (`stock.ts`), Marge (`margin.ts`), OnDeal Score explicable
  (`score.ts`), Avis (`reviews.ts`), Recommandations (`recommendations.ts`), Marketing (`marketing.ts`),
  Assistant (`assistant.ts`).
- Pages : Dashboard, Centre d'intelligence, Product Intelligence (+ détail produit), Stock Intelligence,
  Review Intelligence, Price & Margin Intelligence, Marketing Intelligence (+ Homepage Intelligence),
  Assistant IA, Actions (avec validation humaine explicite), Historique (Audit Log), Paramètres +
  Intégrations, Onboarding.
- Mode Test (avis Judge.me fictifs) porté depuis le composant original, strictement séparé de Review
  Intelligence (table `TestReview` distincte de `Review`), avec disclaimer visible.
- Mode Démo (`isDemo: true`), jeu de données clairement fictif et jamais mélangé aux données réelles.
- 34 tests unitaires (`vitest`) sur le moteur d'intelligence.
- Documentation complète (`README.md`, `docs/ARCHITECTURE.md`, `SETUP.md`, `ENVIRONMENT.md`,
  `INTEGRATIONS.md`, `DEPLOYMENT.md`, `SAAS.md`, `SECURITY.md`).

### Connu comme non fait dans cette version (voir le rapport de livraison)

- Paiement (Stripe ou équivalent) non intégré — modèle de plans prêt, facturation non branchée.
- Contrôle de fonctionnalités par plan appliqué en UI, pas encore répliqué systématiquement au niveau de
  chaque route API.
- OAuth "Installer sur Shopify" en un clic non implémenté (connexion par jeton d'application personnalisée
  uniquement dans cette V1).
- Déploiement de production non effectué (aucun credential Vercel/GitHub disponible dans cet environnement).
