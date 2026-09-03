# Déploiement

## État à la livraison

Le système de déploiement actuel a été identifié : le projet storefront existant d'OnDeal.fr
(`ondeal-marketplace`) est hébergé sur **Vercel** (organisation `on-deal`). OnDeal Intelligence est un projet
Next.js séparé, prêt à être déployé sur la même plateforme (`vercel.json` fourni à la racine).

**Le déploiement réel n'a pas pu être effectué depuis cet environnement d'exécution** : ni le CLI Vercel ni
le CLI GitHub n'y sont authentifiés, et aucun jeton d'API Vercel/GitHub n'était disponible dans les variables
d'environnement de cette session. Effectuer un déploiement nécessite soit une authentification interactive
(navigateur), soit un jeton d'API que nous n'avons pas — conformément à la règle de ne jamais prétendre avoir
déployé quand ce n'est pas le cas, cette étape reste à faire par l'utilisateur (5 minutes, voir ci-dessous).

## Marche à suivre (utilisateur, ~5 minutes)

### Option A — Vercel (recommandé, cohérent avec le reste du projet OnDeal)

1. Créer un nouveau dépôt Git pour ce projet (ou l'ajouter comme dossier dans un dépôt existant) et y pousser
   le code de `ondeal-intelligence/`.
2. Sur [vercel.com/new](https://vercel.com/new), importer ce dépôt dans l'organisation `on-deal`.
3. Renseigner les variables d'environnement de production (voir `ENVIRONMENT.md`) :
   `DATABASE_URL` (voir "Base de données" ci-dessous), `AUTH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, et
   optionnellement `ANTHROPIC_API_KEY`.
4. Déployer — `vercel.json` est déjà configuré (`npm run db:generate && npm run build`).

### Option B — CLI, en local

```bash
npm i -g vercel
vercel login
vercel link
vercel env add DATABASE_URL production
vercel env add AUTH_SECRET production
vercel env add CREDENTIALS_ENCRYPTION_KEY production
vercel deploy --prod
```

## Base de données en production

SQLite (utilisé en développement) n'est pas adapté à un déploiement serverless (Vercel). Avant le premier
déploiement de production :

1. Provisionner une base **PostgreSQL** (Vercel Postgres, Supabase ou Neon conviennent tous — le schéma
   Prisma n'utilise aucun type spécifique à SQLite).
2. Dans `prisma/schema.prisma`, changer `provider = "sqlite"` en `provider = "postgresql"`.
3. Définir `DATABASE_URL` avec l'URL de connexion Postgres fournie par l'hébergeur choisi.
4. Exécuter `npx prisma db push` (ou `prisma migrate deploy` si des migrations versionnées sont préférées)
   puis `npm run db:seed`.

## Après déploiement

- Vérifier `/login` répond (santé de l'application).
- Créer le premier compte, connecter la boutique pilote OnDeal.fr (Shopify + Judge.me) depuis
  Paramètres > Intégrations, lancer une synchronisation manuelle.
- Voir `SECURITY.md` — section "Ce qui reste à durcir" avant une exposition publique à grande échelle.
