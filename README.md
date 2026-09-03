# OnDeal Intelligence

Copilote e-commerce SaaS multi-boutiques : Dashboard, Centre d'intelligence, Product/Stock/Review/Price
Intelligence, moteur de recommandations, assistant IA, actions avec validation humaine, historique complet.

Construit à partir du générateur d'avis Judge.me fictifs fourni initialement, conservé comme **Mode Test**
séparé, et étendu en une véritable plateforme d'intelligence e-commerce (voir `ONDEAL_INTELLIGENCE_RAPPORT_LIVRAISON.md`
à la racine du dépôt pour le rapport de livraison complet).

## Démarrage rapide

```bash
npm install
cp .env.example .env   # puis générer AUTH_SECRET et CREDENTIALS_ENCRYPTION_KEY (voir ENVIRONMENT.md)
npm run db:push        # crée la base SQLite locale
npm run db:seed        # charge les limites de plan (Starter/Pro/Business/Agency)
npm run dev
```

Ouvrez `http://localhost:3000`, créez un compte, puis choisissez soit de connecter une vraie boutique
(Shopify + Judge.me depuis Paramètres > Intégrations), soit d'essayer avec des données de démonstration
clairement étiquetées comme fictives.

Voir `SETUP.md` pour le détail complet, `ARCHITECTURE.md` pour la conception, `ENVIRONMENT.md` pour les
variables d'environnement, `INTEGRATIONS.md` pour Shopify/Judge.me, `SECURITY.md` pour le modèle de sécurité,
`SAAS.md` pour le modèle multi-tenant et les plans, `DEPLOYMENT.md` pour la mise en production.

## Principe central

```
DONNÉES → ANALYSE → INTELLIGENCE → RECOMMANDATION → VALIDATION → ACTION → VÉRIFICATION
```

Aucune donnée n'est inventée : une valeur non disponible s'affiche toujours "Non disponible / connexion
nécessaire", jamais une valeur plausible mais fausse. Les actions sensibles (prix, stock, publication)
exigent toujours une confirmation humaine explicite avant exécution — jamais d'automatisation aveugle dans
cette première version.

## Stack technique

- Next.js 16 (App Router, Turbopack), TypeScript strict
- Prisma ORM — SQLite en développement, PostgreSQL recommandé en production (voir `DEPLOYMENT.md`)
- Authentification maison (session JWT en cookie httpOnly, bcrypt) — pas de dépendance externe
- Chiffrement AES-256-GCM des identifiants d'intégration stockés en base
- Vitest pour les tests unitaires du moteur d'intelligence

## Structure du projet

```
prisma/schema.prisma        Schéma multi-tenant (User → Organization → Store → Données)
src/lib/intelligence/       Moteur de calcul pur (stock, marge, score, avis, recommandations, marketing, assistant)
src/lib/integrations/       Connecteurs Shopify (Admin GraphQL) et Judge.me (REST)
src/lib/sync/               Pipeline FETCH → VALIDATE → NORMALIZE → STORE → ANALYZE → INSIGHTS
src/lib/validation/         Normalisation et détection d'anomalies de données
src/app/(app)/              Pages authentifiées (Dashboard, Intelligence, Products, Stock, Reviews, ...)
src/app/api/                Routes API (auth, sync, actions, assistant, intégrations)
tests/                      Tests unitaires du moteur d'intelligence (34 tests)
```
