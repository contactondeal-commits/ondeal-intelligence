# Intégrations

Chaque connecteur (`src/lib/integrations/*.ts`) est indépendant : si l'un échoue ou n'est pas connecté, le
reste de l'application continue de fonctionner avec les données disponibles ("Non disponible / connexion
nécessaire" plutôt qu'une erreur bloquante).

## Shopify

- **Méthode de connexion (V1)** : application personnalisée ("Custom App") créée dans l'admin Shopify de
  chaque boutique cliente, avec un jeton d'accès Admin API. C'est la méthode la plus rapide à mettre en
  œuvre sans app publique enregistrée dans le Partner Dashboard de Shopify (l'installation OAuth "installer
  sur Shopify" en un clic est documentée comme amélioration future — voir le rapport de livraison,
  section 9 — elle nécessite un compte Partner Shopify et des identifiants d'application que nous n'avons
  pas dans cet environnement).
- **Scopes Admin API requis** : `read_products`, `read_inventory`, `read_orders` (lecture) ; `write_products`
  si les actions "Modifier le prix" / "Dépublier" doivent fonctionner (écriture, toujours derrière
  confirmation humaine — voir `ARCHITECTURE.md`).
- **Ce qui est récupéré** : catalogue complet (produits, variantes, prix, stock), commandes des 30 derniers
  jours (pour la vitesse de vente). Pagination automatique par lots de 50, retry avec backoff sur 429.
- **Ce qui peut être écrit** (actions validées uniquement) : prix d'une variante, statut d'un produit
  (Draft/Active).
- **Fichier** : `src/lib/integrations/shopify.ts`.

## Judge.me

- **Méthode** : jeton API **privé** (pas le jeton public, insuffisant pour cet usage — vérifié lors du
  développement du projet storefront OnDeal.fr, réutilisé ici). Récupérable dans Shopify Admin > Applications
  > Judge.me Reviews > Paramètres > Général > Intégrations > "Voir les jetons API".
- **Ce qui est récupéré** : avis publiés uniquement (`published=true`), avec pagination plafonnée
  (20 pages × 100 avis) pour éviter toute boucle infinie.
- **Données personnelles** : email et IP du client ne sont **jamais** récupérés ni exposés — seuls
  auteur/titre/texte/note/date/statut vérifié le sont.
- **Fichier** : `src/lib/integrations/judgeme.ts`.

## Assistant IA (Anthropic, optionnel)

- Voir `ENVIRONMENT.md`. Le modèle ne reçoit jamais d'accès direct à la base : uniquement un texte de faits
  déjà calculés par le moteur déterministe, avec l'instruction explicite de n'ajouter aucun chiffre non
  présent dans ce texte.

## État à la livraison

Aucun credential réel (Shopify OnDeal.fr, Judge.me OnDeal.fr, clé Anthropic) n'était disponible dans cet
environnement d'exécution — voir le rapport de livraison, section "Configuration humaine restante", pour la
liste précise de ce qui doit être saisi par l'utilisateur pour activer chaque connecteur en conditions
réelles. Le code de chaque connecteur est complet et fonctionnel ; il n'a pas pu être testé contre les vraies
API Shopify/Judge.me d'OnDeal.fr faute d'identifiants dans cette session — il a en revanche été exercé de
bout en bout via le Mode Démo, qui utilise exactement le même moteur d'intelligence et la même chaîne
Prisma que les données réelles, seule la source (Shopify/Judge.me vs. jeu de données fictif) diffère.

## Import bulk Shopify (lecture seule) — 03/09/2026

Pour un gros catalogue, Shopify recommande les *bulk operations* (`bulkOperationRunQuery`), qui produisent
un fichier JSONL téléchargeable. `scripts/ingest-shopify-bulk.ts` ingère ces fichiers (produits +
variantes, commandes + lignes) en réutilisant **exactement** l'étape STORE de la synchronisation live
(`src/lib/sync/shopifyStore.ts`) : même normalisation, mêmes upserts, mêmes clés d'unicité. Il n'écrit
jamais vers Shopify et refuse une boutique de démonstration. Chaque import laisse un `SyncRun`
(`triggeredBy: "bulk_import"`) avec `statsJson` (comptes détaillés, coûts unitaires présents/absents,
signalements qualité, durées par étape).

Le connecteur live lit désormais : pagination complète des variantes (`variants(first: 100)` + continuation
par produit), pagination complète des lignes de commande, `inventoryItem.unitCost` par variante (coût réel
Shopify, stocké dans `Variant.unitCost` — distinct des `CostAssumption` saisies dans OnDeal), et les
commandes comme entités (`Order`/`OrderLine` : annulation, statut financier, total, remboursé, variante par
ligne). `SalesSnapshot` est dérivé de ces lignes (commandes annulées exclues, remboursements non déduits).

Validation du 03/09/2026 sur la boutique réelle (1 730 produits, 16 407 variantes) : voir le rapport de
session dans le projet. Le chemin live (jeton Admin API) n'a pas été exécuté à plein volume — il exige que le
marchand saisisse lui-même son jeton dans Settings › Intégrations ; ses requêtes GraphQL ont été validées
contre le schéma Shopify et exécutées sur une petite page réelle.
