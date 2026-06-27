# Flux d'authentification (mappés sur le backend réel)

> Source de vérité : `src/auth/auth.controller.ts` et `src/auth/auth.service.ts`
> de la branche `dev`. ⚠️ `doc/auth.md` et `doc/api.md` sont **en retard** sur le
> code — cette page reflète le comportement réel.

---

## Endpoints disponibles (branche `dev`)

### Auth

| Méthode | Endpoint | Auth | Entrée → Sortie |
|---|---|---|---|
| `POST` | `/auth/login` | — | `{ username, password }` → `AuthResponse` \| `TotpRequired` |
| `POST` | `/auth/totp/verify` | — | `{ totp_token, code }` → `AuthResponse` |
| `GET` | `/auth/profile` | JWT | → payload JWT `{ sub, email, username, role }` (⚠️ **pas** les clés) |
| `GET` | `/auth/google` \| `/rezel` \| `/dropbox` | — | redirige vers le provider |
| `GET` | `/auth/{provider}/callback` | — | géré par le back → **redirige vers** `FRONTEND_URL/callback?…` |
| `POST` | `/auth/oidc/challenge` | — | `{ pending_token }` → `{ nonce_token, encrypted_challenge, priv_key_enc_1 }` |
| `POST` | `/auth/oidc/verify` | — | `{ nonce_token, plaintext }` → `AuthResponse` \| `TotpRequired` |
| `POST` | `/auth/oidc/setup` | — | matériel de compte → `AuthResponse` |
| `POST` | `/auth/oidc/link-confirm` | — | `{ link_token, auth_hash }` → `AuthResponse` \| `TotpRequired` |
| `POST` | `/auth/oidc/link-confirm-totp` | — | `{ totp_token, code }` → `AuthResponse` |
| `POST` | `/auth/oidc/link` | JWT | `{ token }` → `204` |
| `POST` | `/auth/totp/recover` | — | `{ username, password, recovery_code }` → `AuthResponse` |

### Users

| Méthode | Endpoint | Auth | Note |
|---|---|---|---|
| `POST` | `/users` | — | inscription (matériel crypto complet) |
| `GET` | `/users` | JWT + ADMIN | liste |
| `GET` | `/users/:id` | JWT + self/admin | + `totp_recovery_codes_remaining` |
| `PATCH` | `/users/:id` | JWT + self/admin | maj partielle |
| `DELETE` | `/users/:id` | JWT + self/admin | |
| `GET` | `/users/:id/oidc-connections` | JWT + self/admin | providers liés |
| `DELETE` | `/users/:id/oidc-connections/:provider` | JWT + self/admin | délier |
| `POST` | `/users/:id/totp/enable` | JWT + self/admin | `{ secret, code }` → `{ user, recovery_codes[] }` |
| `POST` | `/users/:id/totp/renew-codes` | JWT + self/admin | → `{ user, recovery_codes[] }` |
| `POST` | `/users/:id/totp/disable` | JWT + self/admin | |

**Types de réponse :**
- `AuthResponse` = `{ access_token: string }` (JWT applicatif, valide 1 jour)
- `TotpRequired` = `{ totp_required: true, totp_token: string }`

---

## Inscription (compte local)

1. L'utilisateur choisit email, username, **mot de passe maître (MP)**.
2. `bootstrapAccount(MP)` (voir [crypto.md](crypto.md)) génère tout le matériel +
   la **Recovery Key**.
3. `POST /users` avec `{ email, username, auth_hash, pub_key, priv_key_enc_1,
   priv_key_enc_2, salt_mp, salt_rc, tree_enc_key }`.
4. Afficher la **Recovery Key une seule fois** (sauvegarde hors-ligne).
5. Rediriger vers le login.

---

## Login local

```
POST /auth/login { username, password: auth_hash }
  ├─ { access_token }                       → connecté
  └─ { totp_required, totp_token }          → écran code TOTP
        └─ POST /auth/totp/verify { totp_token, code } → { access_token }
```

> Le champ `password` reçoit l'**`auth_hash`** dérivé côté client, jamais le MP en
> clair.

**Après obtention du JWT**, le front doit déchiffrer la clé privée pour pouvoir
opérer. Il lui faut `priv_key_enc_1` + `salt_mp` → **ce point dépend d'un endpoint
manquant**, voir [backend-gaps.md](backend-gaps.md).

---

## Callback OIDC — la page `/callback`

Le backend redirige toujours vers `FRONTEND_URL/callback` avec **un** des trois
paramètres. La page lit les query params et route en conséquence :

### Cas A — `?setup_token=…&email=…` (nouvel utilisateur)

Aucun compte n'existe. Écran de **création** : choisir un username + un MP →
`bootstrapAccount(MP)` → `POST /auth/oidc/setup` avec `{ setup_token, username,
auth_hash, pub_key, priv_key_enc_1, priv_key_enc_2, salt_mp, salt_rc,
tree_enc_key }` → `{ access_token }`.

### Cas B — `?link_token=…&email=…` (email déjà connu, à lier)

Un compte existe avec cet email mais sans ce provider. Écran de **liaison** :
saisir le MP → dériver `auth_hash` →

```
POST /auth/oidc/link-confirm { link_token, auth_hash }
  ├─ { access_token }                       → lié + connecté
  └─ { totp_required, totp_token }          → écran code TOTP
        └─ POST /auth/oidc/link-confirm-totp { totp_token, code } → { access_token }
```

### Cas C — `?token=…` (utilisateur OIDC existant) ⚠️

**Attention : ce `token` n'est PAS un JWT final**, c'est un token « pending »
(valide 10 min). Il faut prouver la possession de la clé privée via le challenge :

```
1. POST /auth/oidc/challenge { pending_token: token }
     → { nonce_token, encrypted_challenge, priv_key_enc_1 }
2. Demander le MP → dériver KEK1 → déchiffrer priv_key_enc_1 → clé privée
3. RSA-OAEP decrypt(encrypted_challenge) avec la clé privée → plaintext (base64)
4. POST /auth/oidc/verify { nonce_token, plaintext }
     ├─ { access_token }                    → connecté
     └─ { totp_required, totp_token }       → POST /auth/totp/verify
```

Avantage : ce flux fournit aussi `priv_key_enc_1`, donc la clé privée est
déchiffrée au passage (pas besoin de l'endpoint manquant pour l'OIDC).

---

## Lier un provider depuis un compte déjà connecté

Depuis les **paramètres**, l'utilisateur déjà authentifié peut ajouter un
provider :

```
1. Ouvrir GET /auth/{provider}  → callback → /callback?setup_token|link_token
2. POST /auth/oidc/link { token }  (+ Bearer JWT)  → 204
```

Pas de re-saisie du MP (l'identité est déjà prouvée par le JWT).

---

## TOTP (double facteur)

- **Activer** : générer un secret base32 côté client → afficher un **QR code**
  (`otpauth://totp/…?secret=…`) → l'utilisateur scanne et saisit un code →
  `POST /users/:id/totp/enable { secret, code }` → afficher les **10 codes de
  récupération une seule fois**.
- **Renouveler les codes** : `POST /users/:id/totp/renew-codes`.
- **Désactiver** : `POST /users/:id/totp/disable`.
- **Codes restants** : champ `totp_recovery_codes_remaining` sur `GET /users/:id`.

---

## Récupération via code TOTP (`/recover`)

Si l'utilisateur perd son second facteur :

```
POST /auth/totp/recover { username, password: auth_hash, recovery_code }
  → { access_token }   (et le TOTP est désactivé automatiquement)
```

> Ceci ne couvre **pas** la perte du mot de passe maître. La récupération via
> Recovery Key (déchiffrer `priv_key_enc_2`, redéfinir un MP) est décrite dans le
> README racine mais n'a **pas encore d'endpoint** — voir
> [backend-gaps.md](backend-gaps.md).
