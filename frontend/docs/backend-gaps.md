# Manques backend à traiter (prérequis front)

> Cette page liste ce qui doit être **fini côté backend** pour que le front puisse
> se brancher proprement. Elle sert de pont avec le travail backend prioritaire.
> Références : branche `dev`, fichiers `src/auth/*` et `src/users/*`.

---

## 🔴 Bloquant — Récupérer le matériel clé après login local

**Problème.** Après `POST /auth/login`, le front n'a aucun moyen d'obtenir
`priv_key_enc_1` + `salt_mp` pour déchiffrer la clé privée :

- `POST /auth/login` ne renvoie que `{ access_token }`.
- `GET /auth/profile` renvoie seulement le payload JWT
  (`{ sub, email, username, role }`) — voir `auth.controller.ts` (`profile()`
  retourne `req.user`).

En OIDC, le flux `POST /auth/oidc/challenge` renvoie déjà `priv_key_enc_1`, donc
seul le **login local** est bloqué.

**Correctif proposé.** Exposer au propriétaire authentifié ses blobs chiffrés (ils
sont inutiles sans le MP). Par exemple `GET /auth/me/keys` (JWT) renvoyant :

```ts
{ pub_key, priv_key_enc_1, priv_key_enc_2, salt_mp, salt_rc, tree_enc_key }
```

> À vérifier : `UserEntity` provient du package `@blind-storage/types` (absent du
> disque lors de l'analyse). Confirmer s'il expose déjà certains de ces champs
> avant d'ajouter un endpoint.

---

## 🟠 Changement de mot de passe — stub vide

`AuthService.changePassword` est vide (`// TO BE DONE`) dans
`src/auth/auth.service.ts`. L'écran « changer de mot de passe » du front n'aura
rien derrière tant que ce n'est pas implémenté.

Le re-chiffrement de la clé privée se fait **côté client** ; le backend doit juste
persister `{ auth_hash, priv_key_enc_1, salt_mp }` (et exposer une route +
guard). `priv_key_enc_2` / `salt_rc` restent inchangés (liés à la Recovery Key).

---

## 🟠 Récupération via Recovery Key — pas d'endpoint

Le README racine décrit la récupération en cas de perte du **mot de passe maître**
(déchiffrer `priv_key_enc_2` avec la Recovery Key, puis redéfinir un MP et
ré-uploader `priv_key_enc_1`). Aucun endpoint ne couvre ce flux aujourd'hui.

> Ne pas confondre avec `POST /auth/totp/recover`, qui ne concerne que la perte du
> **second facteur TOTP**.

Nécessaire : une route pour livrer `priv_key_enc_2` + `salt_rc` (à partir d'un
identifiant), puis une route de mise à jour de `priv_key_enc_1` + `salt_mp` +
`auth_hash`.

---

## 🔵 Phase 2 — Module fichiers absent de `dev`

Les modèles `File`, `FilePermission`, `FileVersion`, `UserTree` existent en base
mais **aucune route ne les expose** sur `dev`. Le module `cloud-storage`
(providers Dropbox + Google Drive) vit sur la branche **`api-cloud`**, non mergée
et basée sur une **structure de code antérieure** (DTOs locaux au lieu de
`@blind-storage/types`, avant le flux OIDC challenge/verify).

Conséquences pour le front :

- Tout l'onglet « fichiers » (upload, download, partage, versioning, arbre
  virtuel) est **maquettable mais non fonctionnel** tant que le cloud n'est pas
  réintégré sur `dev`.
- Le merge devra **porter** `cloud-storage` sur la nouvelle base plutôt que merger
  tel quel.

Endpoints attendus (voir `doc/api.md`) : `GET /cloud-storage/files`,
`POST /cloud-storage/:provider/upload`, `GET /cloud-storage/files/:id/download`,
`DELETE /cloud-storage/files/:id`, + à créer : gestion des permissions/partage et
de l'arbre `UserTree`.

---

## ⚪ Doc backend à resynchroniser

`doc/auth.md` et `doc/api.md` ne décrivent pas `oidc/challenge`, `oidc/verify`,
`totp/verify`, `link-confirm-totp`, et `doc/api.md` documente des routes cloud
absentes de `dev`. À aligner sur le code pour éviter les divergences avec le
front.

---

## Ordre suggéré côté backend

1. `GET /auth/me/keys` (débloque le login local du front) — **Phase 1**.
2. `changePassword` réel — **Phase 1**.
3. Récupération via Recovery Key — **Phase 1**.
4. Réintégration de `cloud-storage` depuis `api-cloud` — **Phase 2**.
5. Resynchronisation de la doc backend.
