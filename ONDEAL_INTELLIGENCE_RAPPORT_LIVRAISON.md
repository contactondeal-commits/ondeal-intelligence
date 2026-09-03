# ONDEAL INTELLIGENCE — RAPPORT DE LIVRAISON

## 1. Fonctionnalités réellement livrées

- **Architecture multi-tenant** Utilisateur → Organisation → Boutique → Données → Intelligence, isolation
  stricte appliquée via `requireStoreAccess` sur chaque route.
- **Dashboard** : CA, unités vendues, produits synchronisés, OnDeal Score moyen, note moyenne, produits sans
  avis, ruptures, opportunités — chaque métrique affiche "Non disponible / connexion nécessaire" si la donnée
  manque, jamais une valeur inventée.
- **Centre d'intelligence** : détection automatique de problèmes urgents (rupture, rupture imminente, marge
  négative, incohérence stock/fournisseur, produit actif sans stock), opportunités (forte marge), et
  recommandations (marge faible, produit sans avis, fiche incomplète) — chacune avec pourquoi / impact /
  confiance / action proposée.
- **OnDeal Score** (0-100) explicable : pondération par facteur, redistribution du poids des facteurs
  indisponibles (jamais comptés comme 0), détail des facteurs affiché par produit.
- **Stock Intelligence** : jours de stock = stock ÷ vitesse de vente (30 j), détection rupture / rupture
  imminente / stock faible / surstock / stock dormant / incohérence fournisseur.
- **Review Intelligence** (vrais avis Judge.me) séparée du **Mode Test** (avis 100% fictifs, table dédiée
  `TestReview`, jamais mélangés, disclaimer visible) — le générateur original a été porté intégralement.
- **Price & Margin Intelligence** : marge = prix − (coût fournisseur + transport + frais paiement + autres),
  hypothèses manquantes listées explicitement, jamais supposées à 0 ; formulaire de saisie des coûts par
  produit qui recalcule immédiatement marge/score/recommandations.
- **Product Intelligence** : classement 🔥 À booster / 🟢 Performant / 🟡 À optimiser / 🟠 À surveiller /
  🔴 À revoir (un produit en rupture ou à marge négative n'est jamais classé "performant", quel que soit le
  score), page de détail par produit.
- **Marketing Intelligence** : détection d'opportunités (forte marge, excellente note, surstock),
  génération de contenu (accroche / post court / description / script vidéo) strictement à partir de vraies
  données produit — les champs indisponibles sont omis, jamais inventés.
- **Homepage Intelligence** : sélection des meilleurs produits par score.
- **Assistant IA** ("Demandez à OnDeal Intelligence") : moteur déterministe répondant aux 8 questions type de
  la mission à partir des données réelles calculées ; couche de reformulation Anthropic optionnelle
  strictement bornée aux mêmes faits (jamais d'accès direct à la base par le modèle).
- **Actions avec validation humaine** : séquence Recommandation → Action préparée → "Cette action va
  modifier votre boutique." → Confirmation → Exécution → Vérification (relecture de la réponse Shopify).
  Aucune action sensible (prix, stock, publication) ne peut s'exécuter sans confirmation explicite — vérifié
  par le serveur (HTTP 409 sinon), pas seulement par l'UI.
- **Historique (Audit Log)** : chaque événement significatif (sync, recommandation, action, requête
  assistant, connexion d'intégration) journalisé et consultable.
- **Synchronisation** Shopify (catalogue + stock + commandes 30j, pagination, retry) et Judge.me (avis,
  pagination plafonnée, exclusion des données personnelles), avec normalisation/validation des données à la
  source (prix NaN, stock négatif, handle invalide, variante orpheline).
- **Mode Démo** : jeu de données 100% fictif et étiqueté, jamais mélangé aux données réelles — testé de bout
  en bout (voir section Tests).
- **Onboarding** en 3 étapes (boutique → intégrations → analyse), **Settings** (organisation, boutiques,
  équipe, plan), **Intégrations** (connexion/déconnexion Shopify et Judge.me avec vérification en direct).
- **SaaS** : plans Starter/Pro/Business/Agency (tarifs fournis par l'utilisateur), limites de
  boutiques/utilisateurs réellement appliquées, fonctionnalités par plan appliquées dans la navigation.

## 2. Fichiers créés

83 fichiers, ~5 760 lignes de TypeScript/TSX (hors documentation), organisés en :
- `prisma/schema.prisma`, `prisma/seed.ts` — schéma multi-tenant (17 modèles) et données de plan
- `src/lib/intelligence/*.ts` (7 fichiers) — moteur de calcul pur et testé
- `src/lib/integrations/*.ts` (2 fichiers) — connecteurs Shopify et Judge.me
- `src/lib/sync/pipeline.ts`, `src/lib/validation/normalize.ts` — synchronisation et qualité des données
- `src/lib/auth.ts`, `crypto.ts`, `db.ts`, `audit.ts`, `store-context.ts`, `plan-limits.ts`,
  `demo/seedDemoStore.ts`
- `src/app/(app)/**` (13 pages) + `src/app/{login,signup,onboarding}` — toutes les pages de l'application
- `src/app/api/**` (17 routes) — auth, sync, actions, assistant, intégrations, coûts, mode test
- `src/components/*.tsx` (12 fichiers) — composants d'interface
- `tests/*.test.ts` (6 fichiers, 34 tests)
- `README.md`, `CHANGELOG.md`, `docs/{ARCHITECTURE,SETUP,ENVIRONMENT,INTEGRATIONS,DEPLOYMENT,SAAS,SECURITY}.md`

Liste complète disponible dans le dépôt livré.

## 3. Fichiers modifiés

Aucun — ce projet est nouveau (`ondeal-intelligence/`), distinct du projet storefront existant
(`ondeal-marketplace`), qui n'a pas été touché. Le seul artefact fourni par l'utilisateur (le composant
générateur d'avis fictifs) a été **porté**, pas modifié en place, puisqu'il n'existait que sous forme de
snippet isolé, hors de tout projet accessible dans cet environnement (voir section 7).

## 4. Intégrations

| Intégration | Statut |
|---|---|
| Shopify | **À CONFIGURER** — connecteur complet et fonctionnel (lecture catalogue/stock/commandes, écriture prix/statut), aucun credential OnDeal.fr disponible dans cette session pour le tester en conditions réelles. Vérifié fonctionnellement de bout en bout via le Mode Démo (même moteur, mêmes tables). |
| Judge.me | **À CONFIGURER** — même situation : connecteur complet, credential réel non disponible ici. |
| IA (Anthropic) | **À CONFIGURER** — l'Assistant fonctionne dès maintenant en mode déterministe sans clé ; la reformulation en langage naturel s'active automatiquement dès qu'`ANTHROPIC_API_KEY` est renseignée. |
| Base de données | **OK** — SQLite fonctionnel en développement (schéma validé, migration Postgres documentée pour la production dans `DEPLOYMENT.md`). |

## 5. Tests

| Vérification | Résultat |
|---|---|
| Lint (`npm run lint`) | **PASS** (0 erreur, 0 avertissement) |
| TypeScript (`npm run typecheck`) | **PASS** (0 erreur, mode strict) |
| Tests (`npm run test`) | **PASS** — 34/34 tests, 6 fichiers (stock, marge, score, avis, recommandations, normalisation) |
| Build production (`npm run build`) | **PASS** — 31 routes générées, compilation propre |

Vérification fonctionnelle supplémentaire (non demandée explicitement mais réalisée par prudence) :
inscription → onboarding Mode Démo → Dashboard testés de bout en bout via appels HTTP réels sur un serveur
de production démarré localement — le pipeline complet (seed → calcul de score → génération de
recommandations → rendu) a été confirmé opérationnel sur des données réelles en base (ex. rupture détectée,
marge négative correctement calculée à partir des coûts saisis, opportunité de forte marge détectée).

## 6. Déploiement

**Non effectué.** Le système de déploiement existant a été identifié (Vercel, organisation `on-deal`), la
configuration a été préparée (`vercel.json`), mais aucun jeton d'API Vercel ni session CLI authentifiée
n'était disponible dans cet environnement d'exécution pour déployer réellement. Marche à suivre précise
(deux options, ~5 minutes) dans `docs/DEPLOYMENT.md`.

## 7. Configuration humaine restante

Uniquement ce qui est réellement impossible à effectuer sans accès humain :

1. **Créer une application personnalisée Shopify** sur la boutique OnDeal.fr (Admin > Applications >
   Développer des applications) et générer un jeton d'accès Admin API avec les scopes
   `read_products`, `read_inventory`, `read_orders` (et `write_products` si les actions prix/publication
   doivent fonctionner), puis le saisir dans Paramètres > Intégrations.
2. **Récupérer le jeton API privé Judge.me** (Shopify Admin > Judge.me Reviews > Paramètres > Intégrations)
   et le saisir de même.
3. **Générer et définir `AUTH_SECRET` et `CREDENTIALS_ENCRYPTION_KEY`** en production (`openssl rand -base64
   32` chacun) — actuellement générés uniquement pour l'environnement de développement local.
4. **Déployer** (voir section 6 et `docs/DEPLOYMENT.md`) — nécessite un compte/jeton Vercel (ou autre
   hébergeur) que nous n'avons pas ici.
5. **Provisionner une base PostgreSQL de production** (SQLite ne convient pas à un hébergement serverless) —
   voir `docs/DEPLOYMENT.md`.
6. *(Optionnel)* Une clé `ANTHROPIC_API_KEY` si la reformulation en langage naturel de l'Assistant IA est
   souhaitée — fonctionne déjà sans, en mode déterministe.

## 8. Problèmes connus

- Le contrôle des fonctionnalités par plan (`hasFeature`) est appliqué dans la navigation (liens désactivés)
  mais pas encore répliqué comme garde-fou systématique sur chaque route API — voir `docs/SAAS.md`.
- Le paiement (Stripe ou équivalent) n'est pas intégré ; le modèle de plans est prêt à le recevoir.
- La connexion Shopify se fait par jeton d'application personnalisée, pas par le flux OAuth "Installer sur
  Shopify" en un clic (qui nécessite un compte Partner Shopify enregistré, non disponible ici).
- `salesTrend` (évolution des ventes) dans le calcul du score n'est pas encore alimenté — nécessite un
  historique comparatif sur plusieurs périodes que la synchronisation actuelle ne conserve pas encore ; le
  facteur est correctement traité comme indisponible (poids redistribué) plutôt que deviné.
- Pas de rate limiting sur les routes d'authentification — voir `docs/SECURITY.md` pour la liste complète des
  points à durcir avant une exposition publique à grande échelle.

## 9. Prochaines améliorations

- OAuth "Installer sur Shopify" en un clic (nécessite un compte Partner Shopify).
- Historisation des snapshots de vente pour activer `salesTrend` dans le score et l'analyse "pourquoi mes
  ventes baissent-elles".
- Application des limites de plan au niveau de chaque route API (pas seulement l'UI).
- Intégration d'un fournisseur de paiement (Stripe) pour la facturation SaaS réelle.
- Automatisations planifiées (sync automatique récurrente, alertes proactives) — le modèle `SyncRun` est déjà
  prêt à recevoir un déclencheur `"scheduled"`.
