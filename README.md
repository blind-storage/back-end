# Blind Storage — Backend

API REST Zero Knowledge pour le stockage chiffré de fichiers. Le serveur ne voit jamais les données en clair, les clés privées, ni les mots de passe.

## Principe de fonctionnement

Toute la cryptographie s'exécute **côté client** dans le navigateur (Web Crypto API). Le backend stocke uniquement des artefacts déjà chiffrés et distribue les clés publiques entre utilisateurs. Même un attaquant ayant un accès complet à la base de données ne peut pas lire les fichiers ou usurper une identité sans le mot de passe maître du propriétaire.

| Ce que le serveur stocke | Ce que le serveur ne voit jamais |
|---|---|
| Clés publiques RSA (distribuables) | Clés privées en clair |
| Clés privées chiffrées par AES-GCM | Mot de passe maître |
| `auth_hash` (dérivé PBKDF2 côté client) | Fichiers en clair |
| Fichiers chiffrés (via cloud tiers) | FEK / TEK en clair |

## Documentation

| Document | Contenu |
|---|---|
| [Architecture & modèle cryptographique](doc/architecture.md) | Vue d'ensemble du système Zero Knowledge |
| [Flux cryptographiques](doc/crypto-flows.md) | Diagrammes séquentiels de chaque opération (inscription, login, upload, partage…) |
| [PKI — Infrastructure à Clés Publiques](doc/pki.md) | Hiérarchie des clés, rôle du serveur comme key server, modèle de confiance |
| [Inventaire des algorithmes](doc/crypto-algorithms.md) | Tableau de tous les algorithmes, tailles de clés, paramètres et références normatives |
| [Authentification](doc/auth.md) | Endpoints auth, OIDC, TOTP — flux détaillés et guards |
| [Swagger interactif](http://localhost:3000/api/docs) | Interface OpenAPI *(serveur lancé requis)* |
| [Logging](doc/logger.md) | Configuration Winston / ECS |

---

## Stack technique

| Couche | Technologie |
|---|---|
| Framework | NestJS 11 (Node.js) |
| Base de données | PostgreSQL + Prisma 7 |
| Auth | Passport.js (local, JWT, Google, Rezel, Dropbox) |
| 2FA | otplib (TOTP/HOTP) |
| Logging | Winston + ECS format |
| Docs API | Swagger / OpenAPI |

---

## Démarrage rapide

### Prérequis

- Node.js ≥ 20
- Docker & Docker Compose

### Installation

```bash
# Depuis la racine du monorepo
cd back-end
npm install

# Copier et remplir les variables d'environnement
cp .env.example .env
```

### Lancer la base de données

```bash
docker compose up -d
```

### Initialiser Prisma

```bash
npx prisma migrate deploy
npx prisma generate
```

> En développement, pour créer une migration après modification du schéma :
> ```bash
> npx prisma migrate dev --name <nom>
> ```

### Lancer le serveur

```bash
# Développement (hot reload)
npm run start:dev

# Production
npm run build && npm run start:prod
```

L'API est disponible sur `http://localhost:3000`.

---

## Variables d'environnement

| Variable | Description |
|---|---|
| `PORT` | Port du serveur NestJS (défaut : `3000`) |
| `DATABASE_URL` | URL de connexion Prisma/PostgreSQL |
| `POSTGRES_USER` | Utilisateur PostgreSQL |
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL |
| `POSTGRES_DB` | Nom de la base de données |
| `POSTGRES_PORT` | Port conteneur PostgreSQL (défaut : `5432`) |
| `JWT_SECRET` | Secret de signature des JWT (HS256) |
| `GOOGLE_CLIENT_ID` | App ID Google OAuth2 |
| `GOOGLE_SECRET` | App Secret Google OAuth2 |
| `GOOGLE_CALLBACK_URL` | URL de callback Google |
| `REZEL_CLIENT_ID` | Client ID Rezel OIDC |
| `REZEL_SECRET` | Client Secret Rezel OIDC |
| `REZEL_CALLBACK_URL` | URL de callback Rezel |
| `REZEL_ISSUER_URL` | Issuer URL Rezel |
| `REZEL_AUTH_URL` | Authorization URL Rezel |
| `REZEL_TOKEN_URL` | Token URL Rezel |
| `REZEL_USERINFO_URL` | UserInfo URL Rezel |
| `DROPBOX_CLIENT_ID` | App key Dropbox OAuth2 |
| `DROPBOX_CLIENT_SECRET` | App secret Dropbox OAuth2 |
| `DROPBOX_CALLBACK_URL` | URL de callback Dropbox |

---

## Authentification

Trois méthodes combinables sur un même compte :

| Méthode | Endpoint | Description |
|---|---|---|
| **Locale** | `POST /auth/login` | `username` + `auth_hash` (PBKDF2 côté client) |
| **Google OAuth2** | `GET /auth/google` | Connexion via compte Google |
| **Rezel OIDC** | `GET /auth/rezel` | SSO Rezel (Télécom Paris) |
| **Dropbox OAuth2** | `GET /auth/dropbox` | Connexion via compte Dropbox |

La connexion OIDC sur un compte existant utilise un **challenge RSA** pour prouver la possession de la clé privée sans envoyer le mot de passe maître au serveur. Voir [doc/crypto-flows.md](doc/crypto-flows.md#3-connexion-oidc-avec-preuve-de-cl%C3%A9-challenge-rsa).

---

## Tests

```bash
npm test            # Tests unitaires
npm run test:cov    # Couverture de code
npm run test:e2e    # Tests end-to-end
```

---

## Modèle de données principal

```
User
├── pub_key              (clé publique RSA, distribuée librement)
├── priv_key_enc_1       (clé privée chiffrée par KEK_1 = PBKDF2(MP))
├── priv_key_enc_2       (clé privée chiffrée par KEK_2 = PBKDF2(RC))
├── auth_hash            (PBKDF2(MP, salt_mp) — comparé par timingSafeEqual)
├── tree_enc_key         (TEK chiffré par RSA-OAEP)
├── OidcConnection[]     (liaisons Google/Rezel/Dropbox)
├── TotpRecoveryCode[]   (codes TOTP hachés SHA-256)
├── UserTree             (arbre chiffré AES-GCM)
└── File[]
    └── FilePermission[] (enc_fek par destinataire, droits read/write)
        └── FileVersion[] (signature par version)
```

---

## Contributeurs

- **Thomas Cadegros** — Étudiant cycle ingénieur cybersécurité, Télécom Paris — [thomas.cadegros@telecom-paris.fr](mailto:thomas.cadegros@telecom-paris.fr)
- **Amine Slaoui** — Étudiant cycle ingénieur cybersécurité, Télécom Paris — [amine.slaoui@telecom-paris.fr](mailto:amine.slaoui@telecom-paris.fr)
