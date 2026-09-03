# Variables d'environnement

Toutes les variables sont documentées avec leur usage exact dans `.env.example` à la racine — ce fichier
en donne le contexte.

| Variable | Requise | Description |
|---|---|---|
| `DATABASE_URL` | Oui | Connexion base de données. `file:./prisma/dev.db` en dev (SQLite, zéro config). En production, une URL PostgreSQL (voir `DEPLOYMENT.md`). |
| `AUTH_SECRET` | Oui | Secret de signature des sessions JWT. Générer avec `openssl rand -base64 32`. Sans valeur réelle, toute tentative de connexion échoue explicitement (voir `src/lib/auth.ts`) — jamais de secret par défaut utilisable en production. |
| `CREDENTIALS_ENCRYPTION_KEY` | Oui, dès qu'une intégration est connectée | Clé AES-256-GCM (32 octets, base64) chiffrant les identifiants Shopify/Judge.me stockés en base. Générer avec `openssl rand -base64 32`. |
| `ANTHROPIC_API_KEY` | Non | Si absente, l'Assistant IA répond en mode déterministe (moteur de règles sur données réelles). Si présente, une couche de reformulation en langage naturel est appliquée par-dessus les mêmes données calculées — jamais un accès direct du modèle à la base (voir `src/lib/intelligence/assistant.ts`). |
| `NODE_ENV` | Non | `development` / `production`. |
| `APP_URL` | Non | URL publique de l'application (informatif). |

## Identifiants d'intégration — PAS dans `.env`

Les identifiants Shopify (`domain`, `accessToken`) et Judge.me (`shopDomain`, `apiToken`) ne sont **jamais**
des variables d'environnement globales : ils sont saisis par boutique depuis **Paramètres > Intégrations**,
vérifiés en direct auprès du fournisseur, puis chiffrés et stockés dans `Integration.encryptedCredentials`.
Ceci est nécessaire pour un SaaS multi-boutiques : chaque boutique a ses propres identifiants.

## Aucun secret n'a été inventé

Aucune valeur de `.env.example` n'a été remplacée par une valeur plausible mais fausse. Les champs marqués
`changeme-...` DOIVENT être remplacés avant tout usage réel ; le code refuse explicitement de démarrer une
opération sensible (session, chiffrement) tant que ce n'est pas fait, plutôt que de fonctionner silencieusement
avec un secret faible.
