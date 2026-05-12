# Blind Storage

API backend Zero Knowledge pour le stockage chiffré de fichiers.

## Objectifs

- **Zero Knowledge :** Le serveur ne voit jamais les données en clair, les clés privées ni les fichiers déchiffrés.
- **Multi-plateforme :** API RESTful pour les applications Web et Mobile.
- **Gestion multi-terminaux :** Synchronisation sécurisée sur plusieurs appareils liés à un seul compte.
- **Partage sécurisé :** Partage de fichiers entre utilisateurs avec droits d'accès granulaires.
- **Intégration Cloud :** Stockage des fichiers chiffrés sur des fournisseurs tiers (Dropbox, Google Cloud, etc.).
- **Résilience :** Solution de recouvrement en cas de perte d'un terminal.

## Documentation

- [Architecture & Modèle Cryptographique](doc/architecture.md)
- [Schémas des Flux Cryptographiques](doc/crypto-flows.md)
- [Authentification](doc/auth.md)
- [Swagger interactif](http://localhost:3000/api/docs) *(serveur lancé)*

---

## Get Started

### Prérequis

- [Node.js](https://nodejs.org/) >= 20
- [Docker](https://www.docker.com/) & Docker Compose

### Installation

```bash
# 1. Cloner le dépôt
git clone https://github.com/thomas-cad/blind-storage.git
cd blind-storage

# 2. Installer les dépendances
npm install

# 3. Configurer les variables d'environnement
cp .env.example .env
# Remplir les valeurs dans .env
```

### Lancer la base de données

```bash
docker compose up -d
```

### Initialiser la base de données (Prisma)

```bash
# Appliquer les migrations et générer le client
npx prisma migrate deploy
npx prisma generate
```

> En développement, pour créer une nouvelle migration après modification du schéma :
> ```bash
> npx prisma migrate dev --name <nom-de-la-migration>
> ```

### Lancer le backend

```bash
# Développement (hot reload)
npm run start:dev

# Production
npm run build && npm run start:prod
```

L'API est disponible sur `http://localhost:3000` (ou le `PORT` défini dans `.env`).

---

## Variables d'environnement

| Variable | Description |
|---|---|
| `PORT` | Port d'écoute du serveur NestJS (défaut : `3000`) |
| `DATABASE_URL` | URL de connexion Prisma |
| `POSTGRES_USER` | Utilisateur PostgreSQL |
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL |
| `POSTGRES_DB` | Nom de la base de données |
| `POSTGRES_PORT` | Port exposé par le conteneur (défaut : `5432`) |
| `JWT_SECRET` | Secret de signature des tokens JWT |
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

Voir `.env.example` pour un exemple complet.

---

## Authentification

Trois méthodes de connexion sont supportées, combinables sur un même compte :

| Méthode | Description |
|---|---|
| **Locale** | `username` + `auth_hash` (dérivé du mot de passe maître côté client) |
| **Google OAuth2** | Connexion via compte Google |
| **Rezel OIDC** | Connexion via le SSO Rezel (Télécom Paris) |
| **Dropbox OAuth2** | Connexion via compte Dropbox |

Le serveur ne voit jamais le mot de passe en clair. `auth_hash` est calculé côté client par KDF et comparé par `timingSafeEqual`.

Pour le détail des flux (création de compte, liaison de providers, TOTP) : [doc/auth.md](doc/auth.md).

---

## Contributeurs

- **Thomas Cadegros** — Étudiant cycle ingénieur cybersécurité, Télécom Paris — [thomas.cadegros@telecom-paris.fr](mailto:thomas.cadegros@telecom-paris.fr)
- **Amine Slaoui** — Étudiant cycle ingénieur cybersécurité, Télécom Paris — [amine.slaoui@telecom-paris.fr](mailto:amine.slaoui@telecom-paris.fr)
