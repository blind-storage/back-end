# Blind Storage — Contrat API

> **Version** : état au 24 mai 2026 — branche `api-cloud`  
> **Base URL** : `https://<host>/`  
> **Format** : JSON (sauf téléchargement de fichier)  
> **Auth** : Bearer JWT dans l'en-tête `Authorization: Bearer <access_token>`

---

## Sommaire

1. [Types communs](#types-communs)
2. [Authentification](#authentification)
3. [Utilisateurs](#utilisateurs)
4. [Stockage cloud](#stockage-cloud)
5. [Codes d'erreur](#codes-derreur)
6. [Notes cryptographiques](#notes-cryptographiques)

---

## Types communs

### `UserEntity`

Retourné par toutes les routes liées aux utilisateurs. Ne contient **jamais** de secret (pas de `auth_hash`, `priv_key_enc_*`, `salt_*`, `totpSecret`).

```ts
{
  id: string            // UUID v4
  email: string
  username: string
  pub_key: string       // Clé publique RSA/EC (base64 ou PEM, définie côté client)
  role: "USER" | "ADMIN"
  totpEnabled: boolean
  totp_recovery_codes_remaining?: number  // Présent uniquement sur GET /users/:id
}
```

### `AuthResponseDto`

```ts
{ access_token: string }  // JWT signé, durée 1 jour
```

### `OidcPendingResponseDto`

Retourné quand un utilisateur OIDC se connecte pour la première fois (aucun compte existant).

```ts
{
  setup_required: true
  setup_token: string   // JWT temporaire 15 min
  email: string         // Email fourni par le provider OIDC
}
```

### `OidcLinkPendingResponseDto`

Retourné quand l'email OIDC correspond à un compte existant sans connexion OIDC liée.

```ts
{
  link_required: true
  link_token: string    // JWT temporaire 15 min
  email: string
}
```

### `FileListItem`

```ts
{
  id: string                          // UUID en base de données (utiliser pour download/delete)
  name: string                        // Nom original du fichier
  provider: "google-drive" | "dropbox"
  createdAt: string                   // ISO 8601
  mimeType?: string
  enc_fek: string                     // FEK chiffrée avec la clé publique de l'utilisateur
  signature: string                   // Signature de l'utilisateur sur le fichier chiffré (base64)
}
```

---

## Authentification

### Flux de connexion locale

```
POST /auth/login  →  { access_token }
```

### Flux OIDC (Google / Rezel / Dropbox)

```
1. Ouvrir  GET /auth/google  (ou /rezel, /dropbox)
           → redirect automatique vers le provider

2. Callback → trois cas possibles :

   a) Compte lié existant    → { access_token }
   b) Nouvel utilisateur     → { setup_required, setup_token, email }
                                  → POST /auth/oidc/setup  →  { access_token }
   c) Email déjà en DB       → { link_required, link_token, email }
                                  → POST /auth/oidc/link-confirm  →  { access_token }
```

---

### `POST /auth/login`

Connexion avec identifiants locaux.

**Auth** : aucune  
**Body** :

| Champ | Type | Requis | Description |
|---|---|---|---|
| `username` | string | ✓ | |
| `password` | string | ✓ | Mot de passe en clair — la comparaison côté serveur utilise `auth_hash` |

**Réponse 200** : `AuthResponseDto`

**Réponse 401** : identifiants invalides

---

### `GET /auth/profile`

Retourne les données du token JWT courant.

**Auth** : Bearer JWT  
**Réponse 200** :

```ts
{
  id: string
  email: string
  username: string
  pub_key: string
  priv_key_enc_1: string    // Clé privée chiffrée (déchiffrable avec le mot de passe maître)
  priv_key_enc_2: string    // Clé privée chiffrée (déchiffrable avec le code de récupération)
  tree_enc_key: string      // Clé de l'arborescence chiffrée
  totpEnabled: boolean
  role: "USER" | "ADMIN"
}
```

---

### `GET /auth/google`

Démarre le flux OAuth2 Google (scope : `email`, `profile`).  
Redirige le navigateur vers Google.

**Auth** : aucune

---

### `GET /auth/google/callback`

Callback automatique après consentement Google. **Ne pas appeler directement.**

**Réponse 200** : `AuthResponseDto` | `OidcPendingResponseDto` | `OidcLinkPendingResponseDto`

---

### `GET /auth/rezel`

Démarre le flux OIDC Rezel. Redirige vers le provider Rezel.

**Auth** : aucune

---

### `GET /auth/rezel/callback`

Callback automatique Rezel. **Ne pas appeler directement.**

**Réponse 200** : `AuthResponseDto` | `OidcPendingResponseDto` | `OidcLinkPendingResponseDto`

---

### `GET /auth/dropbox`

Démarre le flux OAuth2 Dropbox. Redirige vers Dropbox.

**Auth** : aucune

---

### `GET /auth/dropbox/callback`

Callback automatique Dropbox. **Ne pas appeler directement.**

**Réponse 200** : `AuthResponseDto` | `OidcPendingResponseDto` | `OidcLinkPendingResponseDto`

---

### `POST /auth/oidc/setup`

Finalise la création de compte après une première connexion OIDC (`setup_required: true`).  
Le client génère tout le matériel cryptographique avant d'appeler cette route.

**Auth** : aucune  
**Body** :

| Champ | Type | Requis | Description |
|---|---|---|---|
| `setup_token` | string | ✓ | Token reçu dans `OidcPendingResponseDto` (valide 15 min) |
| `username` | string | ✓ | Pseudonyme choisi |
| `auth_hash` | string | ✓ | Hash du mot de passe maître (dérivé côté client) |
| `pub_key` | string | ✓ | Clé publique |
| `priv_key_enc_1` | string | ✓ | Clé privée chiffrée par le mot de passe maître |
| `priv_key_enc_2` | string | ✓ | Clé privée chiffrée par le code de récupération |
| `salt_mp` | string | ✓ | Salt pour la dérivation du mot de passe maître |
| `salt_rc` | string | ✓ | Salt pour la dérivation du code de récupération |
| `tree_enc_key` | string | ✓ | Clé de l'arborescence chiffrée |

**Réponse 200** : `AuthResponseDto`  
**Réponse 401** : token invalide ou expiré  
**Réponse 409** : compte OIDC déjà lié

---

### `POST /auth/oidc/link-confirm`

Lie un provider OIDC à un compte existant en confirmant avec le hash du mot de passe maître (`link_required: true`).

**Auth** : aucune  
**Body** :

| Champ | Type | Requis | Description |
|---|---|---|---|
| `link_token` | string | ✓ | Token reçu dans `OidcLinkPendingResponseDto` |
| `auth_hash` | string | ✓ | Hash du mot de passe maître pour vérification d'identité |

**Réponse 200** : `AuthResponseDto`  
**Réponse 401** : token invalide ou mot de passe incorrect  
**Réponse 409** : connexion OIDC déjà liée à un autre compte

---

### `POST /auth/oidc/link`

Lie un provider OIDC supplémentaire à un compte déjà authentifié (JWT valide requis).

**Auth** : Bearer JWT  
**Body** :

| Champ | Type | Requis | Description |
|---|---|---|---|
| `token` | string | ✓ | `setup_token` ou `link_token` reçu après le callback OAuth |

**Réponse 200** : `{}` (vide)  
**Réponse 401** : token invalide  
**Réponse 409** : connexion OIDC déjà liée

---

### `POST /auth/totp/recover`

Récupère l'accès au compte via un code de récupération TOTP. **Désactive le TOTP** automatiquement.

**Auth** : aucune  
**Body** :

| Champ | Type | Requis | Description |
|---|---|---|---|
| `username` | string | ✓ | |
| `password` | string | ✓ | |
| `recovery_code` | string | ✓ | Code format `XXXX-XXXX-XXXX-XXXX` (usage unique) |

**Réponse 200** : `AuthResponseDto`  
**Réponse 400** : TOTP non activé sur ce compte  
**Réponse 401** : identifiants ou code invalide

---

## Utilisateurs

### `POST /users`

Crée un compte (inscription directe, sans OIDC).  
**Le client génère toutes les clés avant d'appeler cette route.**

**Auth** : aucune  
**Body** :

| Champ | Type | Requis | Description |
|---|---|---|---|
| `email` | string | ✓ | |
| `username` | string | ✓ | |
| `auth_hash` | string | ✓ | Hash du mot de passe maître |
| `pub_key` | string | ✓ | Clé publique |
| `priv_key_enc_1` | string | ✓ | Clé privée chiffrée par le mot de passe maître |
| `priv_key_enc_2` | string | ✓ | Clé privée chiffrée par le code de récupération |
| `salt_mp` | string | ✓ | Salt pour la dérivation du mot de passe maître |
| `salt_rc` | string | ✓ | Salt pour la dérivation du code de récupération |
| `tree_enc_key` | string | ✓ | Clé de l'arborescence chiffrée |

**Réponse 201** : `UserEntity`  
**Réponse 409** : email ou username déjà pris

---

### `GET /users`

Liste tous les utilisateurs.

**Auth** : Bearer JWT — **ADMIN uniquement**  
**Réponse 200** : `UserEntity[]`  
**Réponse 401 / 403** : non autorisé

---

### `GET /users/:id`

Récupère un utilisateur par son UUID.  
Inclut `totp_recovery_codes_remaining`.

**Auth** : Bearer JWT — propriétaire ou admin  
**Paramètre** : `id` — UUID  
**Réponse 200** : `UserEntity` (avec `totp_recovery_codes_remaining`)  
**Réponse 404** : utilisateur introuvable

---

### `PATCH /users/:id`

Met à jour les champs d'un utilisateur. Tous les champs sont optionnels.

**Auth** : Bearer JWT — propriétaire ou admin  
**Paramètre** : `id` — UUID  
**Body** : tous les champs de `POST /users` sont optionnels (partiel)

**Réponse 200** : `UserEntity`  
**Réponse 404** : introuvable  
**Réponse 409** : email ou username déjà pris

---

### `DELETE /users/:id`

Supprime un compte et toutes ses données.

**Auth** : Bearer JWT — propriétaire ou admin  
**Paramètre** : `id` — UUID  
**Réponse 204** : supprimé  
**Réponse 404** : introuvable

---

### `POST /users/:id/totp/enable`

Active le TOTP. Retourne les 10 codes de récupération **une seule fois** — le client doit les afficher immédiatement.

**Auth** : Bearer JWT — propriétaire ou admin  
**Paramètre** : `id` — UUID  
**Body** :

| Champ | Type | Requis | Description |
|---|---|---|---|
| `secret` | string | ✓ | Secret TOTP (base32) généré côté client |

**Réponse 201** :

```ts
{
  user: UserEntity
  recovery_codes: string[]  // 10 codes "XXXX-XXXX-XXXX-XXXX", usage unique
}
```

> ⚠️ Ces codes ne sont **jamais** re-affichables. Le serveur ne stocke que leurs hashes.

---

### `POST /users/:id/totp/renew-codes`

Régénère les 10 codes de récupération TOTP. Invalide les anciens.

**Auth** : Bearer JWT — propriétaire ou admin  
**Paramètre** : `id` — UUID  
**Réponse 200** : même structure que `totp/enable`

---

### `POST /users/:id/totp/disable`

Désactive le TOTP et supprime tous les codes de récupération.

**Auth** : Bearer JWT — propriétaire ou admin  
**Paramètre** : `id` — UUID  
**Réponse 200** : `UserEntity`

---

## Stockage cloud

Toutes les routes nécessitent un **Bearer JWT** valide.  
Le `userId` est extrait du token — **ne pas le passer en query param**.

### `GET /cloud-storage/files`

Liste tous les fichiers de l'utilisateur connecté (tous providers confondus).

**Auth** : Bearer JWT  
**Réponse 200** :

```ts
{
  files: FileListItem[]
}
```

---

### `POST /cloud-storage/:provider/upload`

Upload un fichier vers le provider spécifié.  
Le client chiffre le fichier **avant** l'envoi et fournit la clé de fichier chiffrée (`enc_fek`).

**Auth** : Bearer JWT  
**Paramètre** : `provider` — `google-drive` | `dropbox`  
**Content-Type** : `multipart/form-data`  
**Body** :

| Champ | Type | Requis | Description |
|---|---|---|---|
| `file` | binary | ✓ | Contenu du fichier (chiffré côté client) |
| `enc_fek` | string | ✓ | Clé de fichier (FEK) chiffrée avec la clé publique de l'utilisateur |
| `signature` | string | ✓ | Signature du fichier chiffré avec la clé privée de l'utilisateur (base64) |

**Réponse 201** :

```ts
{
  fileId: string   // UUID en base de données — à conserver pour download/delete
}
```

**Réponse 400** : provider inconnu  
**Réponse 401** : non authentifié au provider cloud (connexion OAuth requise)

---

### `GET /cloud-storage/files/:fileId/download`

Télécharge le contenu chiffré d'un fichier depuis le provider cloud associé.  
Le client déchiffre le contenu en local après vérification de la signature (voir [Notes cryptographiques](#notes-cryptographiques)).

**Auth** : Bearer JWT  
**Paramètre** : `fileId` — UUID (retourné par l'upload)  
**Réponse 200** : `application/octet-stream` — contenu binaire chiffré  
**Réponse 403** : pas de permission de lecture  
**Réponse 404** : fichier introuvable

---

### `DELETE /cloud-storage/files/:fileId`

Supprime un fichier du provider cloud **et** de la base de données.

**Auth** : Bearer JWT  
**Paramètre** : `fileId` — UUID  
**Réponse 204** : supprimé  
**Réponse 403** : pas de permission d'écriture  
**Réponse 404** : fichier introuvable

---

## Codes d'erreur

| Code | Signification |
|------|---------------|
| 400 | Body invalide ou paramètre manquant |
| 401 | Token JWT absent, expiré ou invalide |
| 403 | Accès refusé (rôle insuffisant ou permission manquante) |
| 404 | Ressource introuvable |
| 409 | Conflit (doublon email/username, OIDC déjà lié) |
| 204 | Succès sans contenu (delete) |

---

## Notes cryptographiques

> Ces notes décrivent ce que le **front-end doit implémenter** côté client.

### Matériel clé à générer lors de l'inscription / premier OIDC

| Champ | Contenu |
|---|---|
| `pub_key` | Clé publique asymétrique |
| `priv_key_enc_1` | Clé privée chiffrée avec le mot de passe maître (dérivé via `salt_mp`) |
| `priv_key_enc_2` | Clé privée chiffrée avec le code de récupération (dérivé via `salt_rc`) |
| `auth_hash` | Hash envoyé au serveur pour vérification (le serveur ne connaît pas le mot de passe en clair) |
| `salt_mp` | Salt aléatoire pour la dérivation du mot de passe maître |
| `salt_rc` | Salt aléatoire pour la dérivation du code de récupération |
| `tree_enc_key` | Clé symétrique chiffrée (pour l'arborescence de fichiers) |

### Upload de fichier

```
1. Générer une FEK (File Encryption Key) aléatoire
2. Chiffrer le fichier avec la FEK  →  fichier_chiffré
3. Chiffrer la FEK avec pub_key de l'utilisateur  →  enc_fek
4. Signer le fichier chiffré avec priv_key de l'utilisateur  →  signature
5. Envoyer : fichier_chiffré + enc_fek + signature
```

### Téléchargement et déchiffrement de fichier

```
1. GET /cloud-storage/files  →  récupérer enc_fek + signature du fichier voulu
2. GET /cloud-storage/files/:fileId/download  →  fichier_chiffré (octet-stream)
3. Vérifier la signature du fichier chiffré avec pub_key
4. Déchiffrer la FEK avec priv_key  →  fek
5. Déchiffrer le fichier avec la FEK  →  fichier en clair
```

> Le champ `provider` de `FileListItem` indique depuis quel cloud provider le fichier est hébergé ; le backend résout l'accès au provider correspondant transparemment.

### Connexion OIDC sans mot de passe

Les utilisateurs créés uniquement via OIDC (`auth_hash = null`) ne peuvent pas se connecter en local. Ils doivent passer par leur provider OIDC à chaque fois.

---

## Routes en cours de développement / non finalisées

| Route | État | Note |
|---|---|---|
| Vérification TOTP lors du login | 🚧 À faire | Le login local n'exige pas encore le TOTP même si activé |
| `PATCH /users/:id` changement de mot de passe | 🚧 Stub | La logique de re-chiffrement des fichiers après changement de clé n'est pas implémentée |
| Partage de fichier entre utilisateurs | 🚧 À faire | Le modèle `FilePermission` existe en DB mais aucune route ne permet d'en créer |
| Versioning de fichier | 🚧 À faire | Le modèle `FileVersion` existe en DB mais aucune route ne l'expose |
| Routes legacy (`/auth/google/status`, `/auth/dropbox/tokens`, etc.) | ⚠️ Conflit | Ces routes de l'ancien système (tokens en mémoire) coexistent avec le nouveau — à retirer |
