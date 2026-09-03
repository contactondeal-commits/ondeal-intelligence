# Sécurité

## Secrets

- Aucun secret côté client : les jetons Shopify/Judge.me, `AUTH_SECRET` et `CREDENTIALS_ENCRYPTION_KEY` ne
  sont lus que dans du code serveur (`route.ts`, Server Components, `src/lib/*`) — jamais exposés à un
  composant `"use client"`.
- Identifiants d'intégration chiffrés en base (AES-256-GCM, `src/lib/crypto.ts`) — jamais stockés en clair.
- Mots de passe hashés avec bcrypt (12 rounds, `src/lib/auth.ts`) — jamais stockés en clair ni loggés.

## Isolation multi-tenant

Toute route qui touche à une boutique passe par `requireStoreAccess(storeId)` (`src/lib/auth.ts`), qui
vérifie l'appartenance de l'utilisateur à l'organisation propriétaire via `Membership`, avant toute lecture
ou écriture. Il n'existe aucun autre chemin d'accès aux données d'une boutique dans le code.

## Validation des entrées

Toute route API qui accepte un corps de requête le valide avec `zod` avant utilisation (voir les fichiers
`src/app/api/**/route.ts`) — un payload malformé est rejeté avec un message explicite plutôt que de
provoquer un comportement indéfini.

## Actions sensibles

Voir `ARCHITECTURE.md` — les actions modifiant réellement la boutique (prix, stock, publication) exigent une
confirmation humaine explicite (`CONFIRMED`) avant toute exécution, refusée sinon par le serveur (HTTP 409).

## Journalisation

`AuditLog` trace tout événement significatif (connexion d'intégration, synchronisation, recommandation
créée, action confirmée/exécutée, requête à l'assistant). Aucune donnée sensible (mot de passe, jeton
d'accès) n'est jamais écrite dans un message de log.

## Ce qui reste à durcir avant une mise en production à grande échelle

Documenté honnêtement plutôt que passé sous silence :

- **Rate limiting** des routes API (notamment `/api/auth/login`) : non implémenté dans cette V1. À ajouter
  avant une exposition publique (ex. middleware Next.js + compteur Redis/Upstash).
- **Rotation des clés de chiffrement** : `CREDENTIALS_ENCRYPTION_KEY` est une clé statique. Une rotation
  planifiée nécessiterait un ré-chiffrement des `Integration.encryptedCredentials` existants — non
  implémenté.
- **2FA** : non implémenté (l'authentification maison actuelle est email + mot de passe uniquement).
- **CSP / en-têtes de sécurité HTTP avancés** : non explicitement configurés au-delà des valeurs par défaut
  de Next.js — à ajouter via `next.config.ts` `headers()` avant une mise en production publique.
