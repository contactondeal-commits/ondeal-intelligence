# Architecture

## Hiérarchie multi-tenant

```
Utilisateur → Organisation (Membership : rôle) → Boutique → Données → Intelligence
```

- Un `User` peut appartenir à plusieurs `Organization` via `Membership` (rôle `OWNER`/`ADMIN`/`ANALYST`/`VIEWER`).
- Une `Organization` possède un `Plan` (`STARTER`/`PRO`/`BUSINESS`/`AGENCY`) et zéro ou plusieurs `Store`.
- Toute donnée métier (`Product`, `Variant`, `Review`, `Recommendation`, `ActionItem`, `AuditLog`, ...) est
  rattachée à un `storeId`. **Aucune requête applicative ne doit lire/écrire une donnée sans passer par
  `requireStoreAccess(storeId)`** (voir `src/lib/auth.ts`), qui vérifie que l'utilisateur courant est bien
  membre de l'organisation propriétaire de la boutique. C'est la seule porte d'entrée autorisée — c'est ce qui
  garantit l'isolation stricte entre boutiques/organisations.
- OnDeal.fr est simplement la première boutique pilote créée dans ce modèle — rien dans le code n'est
  spécifique à OnDeal ; le nom n'apparaît que dans les données de démonstration et la documentation.

## Modules (PHASE 2)

| Module | Emplacement | Rôle |
|---|---|---|
| Dashboard | `src/app/(app)/dashboard` | Vue d'ensemble : CA, commandes, score moyen, avis, ruptures |
| Centre d'intelligence | `src/app/(app)/intelligence` | Problèmes urgents / opportunités / recommandations |
| Product Intelligence | `src/app/(app)/products` | Score, classement, détail par produit |
| Stock Intelligence | `src/app/(app)/stock` | Jours de stock, ruptures, incohérences fournisseur |
| Review Intelligence | `src/app/(app)/reviews` | Analyse des vrais avis Judge.me |
| Mode Test | `src/app/(app)/reviews/test-mode` | Générateur d'avis fictifs — strictement séparé |
| Price & Margin Intelligence | `src/app/(app)/pricing` | Marge, hypothèses de coût |
| Marketing Intelligence | `src/app/(app)/marketing` | Opportunités, Homepage Intelligence, génération de contenu |
| Recommendation Engine | `src/lib/intelligence/recommendations.ts` | Règles déterministes → recommandations explicables |
| AI Assistant | `src/app/(app)/assistant` | Requêtes en langage naturel sur les données réelles |
| Actions | `src/app/(app)/actions` | File d'actions avec validation humaine |
| Automations | (préparé, non activé) | Voir `KNOWN_LIMITATIONS` dans le rapport de livraison |
| Integrations | `src/app/(app)/settings/integrations` | Connexion Shopify / Judge.me par boutique |
| Settings | `src/app/(app)/settings` | Organisation, boutiques, équipe |
| Audit Log | `src/app/(app)/audit-log` | Historique complet des événements |

## Flux de données (PHASE 15)

```
FETCH (Shopify/Judge.me) → VALIDATE/NORMALIZE (src/lib/validation) → STORE (Prisma)
  → ANALYZE (src/lib/intelligence/pipeline.ts) → INSIGHTS (ScoreSnapshot + Recommendation)
```

Chaque étape est journalisée dans `SyncRun` (statut, compteurs, échantillon d'erreurs) et dans `AuditLog`
(narratif lisible par un humain). `recomputeStoreIntelligence(storeId)` est le point d'entrée unique du calcul
d'intelligence — appelé après chaque synchronisation, et aussi après toute modification manuelle des
hypothèses de coût (Price & Margin Intelligence), pour rester toujours cohérent avec les dernières données.

## Séquence de validation des actions sensibles (PHASE 13)

```
Recommandation (règle déterministe, données réelles)
  → Action préparée (POST /api/actions)               statut PENDING_VALIDATION
  → "Cette action va modifier votre boutique."         (UI : src/components/ActionRow.tsx)
  → Confirmation humaine (POST /api/actions/:id/confirm)   statut CONFIRMED
  → Exécution (POST /api/actions/:id/execute)          statut EXECUTED | FAILED
  → Vérification : relecture de la réponse de la plateforme (jamais seulement "pas d'erreur")
```

Les types `update_price`, `update_stock`, `publish_product`, `unpublish_product` sont marqués `SENSITIVE` et
ne peuvent JAMAIS passer directement de `PENDING_VALIDATION` à `EXECUTED` — le serveur refuse l'appel
(`409`) si `CONFIRMED` n'a pas été posé explicitement au préalable.

## Pourquoi ces choix

- **SQLite en dev / PostgreSQL en prod** : zéro dépendance externe pour développer et faire tourner les
  tests immédiatement dans n'importe quel environnement, migration transparente vers Postgres en production
  (aucun type spécifique à SQLite utilisé dans le schéma).
- **Authentification maison plutôt qu'un fournisseur externe** : évite une dépendance à un service dont les
  identifiants ne sont pas disponibles dans cet environnement d'exécution, tout en restant un système réel
  (bcrypt + JWT signé, cookie httpOnly) — remplaçable par NextAuth/Clerk plus tard sans changer le modèle de
  données (`User`/`Membership` déjà conçus pour ça).
- **Moteur d'intelligence en fonctions pures testables** (`src/lib/intelligence/*.ts`), séparé de l'accès aux
  données (`src/lib/intelligence/pipeline.ts`) : permet de tester exhaustivement la logique métier sans base
  de données (voir `tests/`), et de la réutiliser telle quelle si l'application évolue (ex. vers des jobs
  planifiés côté serveur).
