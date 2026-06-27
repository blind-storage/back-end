# Frontend — Blind Storage

> **État : documentation uniquement.** Aucun code n'est encore écrit. Ce dossier
> contient la spécification du futur client web. Le backend est prioritaire et
> sera finalisé avant de démarrer l'implémentation, afin d'éviter les conflits.

Client web du projet **Blind Storage**, l'application de stockage de fichiers
**Zero-Knowledge**. Voir le [README racine](../README.md) pour la vision globale.

---

## Le point essentiel à comprendre

Dans cette architecture Zero-Knowledge, **le frontend n'est pas un simple
consommateur d'API : c'est là que vit 100 % de la cryptographie.** Le backend est
volontairement « bête » — il stocke des chaînes opaques (clés chiffrées, blobs de
fichiers, métadonnées) et fait l'OAuth. Tout ce qui touche au secret se passe
dans le navigateur :

- génération de la paire de clés, dérivation KDF (`auth_hash`, KEK1/KEK2) ;
- chiffrement/déchiffrement de la clé privée, des fichiers (FEK/AES-GCM), de
  l'arbre (TEK) ;
- signatures et vérifications.

C'est donc la pièce **la plus sensible** du projet. Aucun secret en clair ne doit
**jamais** quitter le navigateur ni transiter par un serveur Next.

---

## Stack retenue

| Choix | Détail |
|---|---|
| Framework | **Next.js (App Router)** en TypeScript |
| Rendu | **100 % client / static export** — pas de Server Component ni de Route Handler manipulant un secret (voir [docs/architecture.md](docs/architecture.md)) |
| Crypto | **WebCrypto** natif + `hash-wasm` (Argon2id) |
| Divers | `qrcode` (TOTP) |

---

## Documentation

| Document | Contenu |
|---|---|
| [docs/crypto.md](docs/crypto.md) | Décisions cryptographiques, formats imposés par le backend, KDF, pièges WebCrypto, bootstrap de compte |
| [docs/auth-flows.md](docs/auth-flows.md) | Écrans et flux (inscription, login, callback OIDC, TOTP, récupération) mappés sur les **vrais** endpoints du backend |
| [docs/architecture.md](docs/architecture.md) | Arborescence du projet, gestion de session, couche API, contraintes Next.js |
| [docs/backend-gaps.md](docs/backend-gaps.md) | **À traiter côté backend en priorité** — manques bloquants identifiés pour que le front puisse se brancher |

---

## Démarrage local (à venir — référence)

> Rappels pour quand l'implémentation commencera.

**Ports** — le backend écoute **en dur sur `3000`** (voir `src/main.ts`, la variable
`PORT` est ignorée), donc le front ne peut pas y tourner. On utilise **8000** pour
le front (c'est déjà le fallback de `FRONTEND_URL` côté backend).

```bash
# Front (depuis frontend/)
next dev -p 8000
```

**Variables côté backend** à régler pour que le front fonctionne :

| Variable (backend `.env`) | Valeur dev | Pourquoi |
|---|---|---|
| `FRONTEND_URL` | `http://localhost:8000` | Origine **unique** autorisée par le CORS + cible des redirections OIDC (`/callback`) |
| `SESSION_SECRET` | (toute valeur) | Le backend **refuse de démarrer** sans (`src/main.ts`) |
| `JWT_SECRET` | (toute valeur) | Signature des JWT |

**Côté front** : `NEXT_PUBLIC_API_URL=http://localhost:3000`.

Le CORS backend autorise `GET/POST/PATCH/DELETE/OPTIONS` et les en-têtes
`Content-Type` + `Authorization`. Le JWT est envoyé en `Authorization: Bearer …`
(pas de cookie de session pour l'auth applicative).

---

## Phasage prévu

- **Phase 0** — Scaffold Next (`frontend/`, port 8000, static export, TS/ESLint),
  client API, store de session.
- **Phase 1** — `lib/crypto` + inscription + login local + TOTP + callback OIDC +
  paramètres. Brancheable sur la branche `dev`, **sauf** le déchiffrement
  post-login-local qui dépend d'un endpoint manquant (voir
  [docs/backend-gaps.md](docs/backend-gaps.md)).
- **Phase 2** — Module fichiers (upload/download/partage/arbre). **Dépend** du
  merge de la branche `api-cloud` sur `dev`. Maquettable avant, fonctionnel après.
