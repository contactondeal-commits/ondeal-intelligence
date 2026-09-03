# Installation locale

## Prérequis

- Node.js 20+ (validé avec Node 22)
- npm

## Étapes

```bash
npm install
cp .env.example .env
```

Puis générer deux secrets réels et les coller dans `.env` (voir `ENVIRONMENT.md` pour le détail) :

```bash
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 32   # → CREDENTIALS_ENCRYPTION_KEY
```

```bash
npm run db:push    # crée prisma/dev.db (SQLite) à partir du schéma
npm run db:seed    # charge les limites de plan (Starter/Pro/Business/Agency)
npm run dev         # démarre sur http://localhost:3000
```

## Vérifications (comme en CI)

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Les quatre commandes doivent passer sans erreur — c'est l'état dans lequel ce dépôt est livré (voir le
rapport de livraison à la racine).

## Premier compte

1. Ouvrir `/signup`, créer un compte (crée aussi votre première `Organization`, plan `STARTER` par défaut).
2. Dans l'onboarding : soit créer une boutique réelle (puis la connecter depuis Paramètres > Intégrations),
   soit cliquer "Essayer avec des données de démonstration" pour explorer immédiatement avec un jeu de
   données clairement fictif (`isDemo: true`, jamais mélangé à une boutique réelle).
3. Depuis le Dashboard, cliquer "Synchroniser maintenant" une fois Shopify et/ou Judge.me connectés.

## Base de données Studio (optionnel)

```bash
npm run db:studio
```
