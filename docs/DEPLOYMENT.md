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

## Production (état au 04/09/2026)

- **Hébergement** : Vercel, projet `on-deal/ondeal-intelligence`, déploiement automatique à chaque push sur `master` du dépôt `contactondeal-commits/ondeal-intelligence`.
- **Base de données** : PostgreSQL (Neon via l'intégration Vercel). `prisma/schema.prisma` utilise `provider = "postgresql"` ; le développement local utilise aussi PostgreSQL (`DATABASE_URL` locale) — SQLite n'est plus le provider committé.
- **Schéma** : à chaque changement de `schema.prisma`, exécuter `npx prisma db push` avec la `DATABASE_URL` de production (`vercel env pull .env.production.local` puis `npx dotenv -e .env.production.local -- npx prisma db push`, ou équivalent). Le build Vercel n'applique pas le schéma (aucune migration automatique) : c'est volontaire, pour ne jamais modifier la base sans opérateur.
- **Variables d'environnement obligatoires** (Production + Preview) : `DATABASE_URL`, `AUTH_SECRET` (≥ 32 octets aléatoires), `CREDENTIALS_ENCRYPTION_KEY` (32 octets base64). Optionnelle : `ANTHROPIC_API_KEY` (reformulation IA de l'Assistant ; sans elle, mode déterministe). Aucune variable Shopify/Judge.me globale : les jetons sont saisis par boutique dans Paramètres › Intégrations et chiffrés en base (AES-256-GCM).
- **Synchronisation** : manuelle (bouton « Synchroniser » ou connexion d'une intégration). Aucun cron Vercel n'est configuré.
- **Limiteur de débit** des routes d'authentification : en mémoire, par instance serverless (voir `src/lib/rate-limit.ts`). Pour une protection stricte multi-instances, ajouter une règle Vercel WAF ou un limiteur partagé.
- **En-têtes de sécurité** : définis dans `next.config.ts` (CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy).
