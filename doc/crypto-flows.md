# Schémas des Flux Cryptographiques

> **Principe fondamental :** toute la cryptographie s'exécute côté client dans le navigateur (Web Crypto API). Le serveur ne reçoit jamais le mot de passe maître, les clés privées déchiffrées, ni aucun fichier en clair.

---

## 1. Inscription et Génération des Clés

Un seul appel PBKDF2 produit 512 bits, découpés en KEK_1 (32 premiers octets) et auth_hash (32 derniers octets), pour éviter deux dérivations coûteuses.

```mermaid
sequenceDiagram
    participant U as Navigateur (Web Crypto API)
    participant B as Backend (NestJS)
    participant DB as PostgreSQL

    U->>U: Saisie du Mot de Passe Maître (MP)
    U->>U: generateSalt() → salt_mp (32 octets CSPRNG)
    U->>U: generateSalt() → salt_rc (32 octets CSPRNG)
    Note over U: PBKDF2(MP, salt_mp, 600 000 iter, SHA-256) → 512 bits<br/>→ KEK_1 = AES-GCM-256 (bits 0-255)<br/>→ auth_hash = base64(bits 256-511)
    U->>U: generateRecoveryCode() → RC (128 bits, format XXXX-XXXX×8)
    Note over U: PBKDF2(RC, salt_rc, 600 000 iter, SHA-256) → 256 bits<br/>→ KEK_2 = AES-GCM-256
    U->>U: generateKeyPair() → RSA-OAEP 2048 bits (SHA-256)
    U->>U: AES-GCM(KEK_1) → priv_key_enc_1
    U->>U: AES-GCM(KEK_2) → priv_key_enc_2
    U->>U: generateTEK() → TEK (AES-GCM-256 aléatoire)
    U->>U: RSA-OAEP(pub_key, TEK) → tree_enc_key
    U->>U: AES-GCM(TEK, arbre JSON vide) → encrypted_structure + signature
    U->>B: POST /users { username, email, auth_hash,<br/>  pub_key (SPKI/base64), priv_key_enc_1, priv_key_enc_2,<br/>  salt_mp, salt_rc, tree_enc_key }
    B->>DB: Crée User (auth_hash stocké brut, sans re-hachage)
    B-->>U: 201 — Compte créé
    Note over U: RC affiché une seule fois → l'utilisateur le sauvegarde hors ligne<br/>salt_mp et salt_rc → localStorage (blind_salt_<username>)
```

> `auth_hash` est calculé côté client via PBKDF2 et envoyé tel quel. Le serveur le stocke et le compare ultérieurement avec `timingSafeEqual` — **aucun hachage supplémentaire côté serveur**.

---

## 2. Connexion Locale

```mermaid
sequenceDiagram
    participant U as Navigateur
    participant B as Backend

    U->>U: Lecture salt_mp depuis localStorage
    Note over U: PBKDF2(MP, salt_mp, 600 000 iter, SHA-256) → 512 bits<br/>→ KEK_1 (en mémoire, jamais persisté)<br/>→ auth_hash (envoyé au serveur)
    U->>B: POST /auth/login { username, password: auth_hash }
    B->>B: timingSafeEqual(auth_hash_reçu, auth_hash_stocké)
    B->>B: Si TOTP activé → JWT "totp_pending" (5 min)
    B-->>U: { access_token } ou { totp_required, totp_token }
    Note over U: KEK_1 reste en mémoire React (AuthContext.privateKey)<br/>Effacée au rechargement de page → saisie du MP obligatoire
```

---

## 3. Connexion OIDC avec Preuve de Clé (Challenge RSA)

Lorsqu'un utilisateur se connecte via Google/Rezel/Dropbox, le serveur doit vérifier qu'il détient bien la clé privée (et donc connaît son MP) avant d'émettre un JWT complet. Ce flux évite d'envoyer le MP ou la KEK au serveur.

```mermaid
sequenceDiagram
    participant U as Navigateur
    participant B as Backend
    participant P as Fournisseur OIDC

    U->>B: GET /auth/google (ou /rezel, /dropbox)
    B-->>U: Redirect vers le fournisseur
    U->>P: Authentification OIDC
    P-->>B: Callback OAuth2 (code → tokens + profil)
    B->>B: Trouve OidcConnection → émet pending_token (JWT oidcPending, 10 min)
    B-->>U: { access_token: pending_token }

    U->>B: POST /auth/oidc/challenge { pending_token }
    B->>B: Vérifie pending_token
    B->>B: randomBytes(32) → nonce (32 octets)
    B->>B: RSA-OAEP(pub_key, nonce) → encrypted_challenge
    B->>B: Émet nonce_token (JWT oidcNonce contenant nonce, 5 min)
    B-->>U: { nonce_token, encrypted_challenge, priv_key_enc_1 }

    Note over U: Déchiffre priv_key_enc_1 avec KEK_1 (saisie du MP) → clé privée RSA<br/>Déchiffre encrypted_challenge avec clé privée → plaintext nonce
    U->>B: POST /auth/oidc/verify { nonce_token, plaintext }
    B->>B: timingSafeEqual(plaintext, nonce stocké dans JWT)
    B-->>U: { access_token } (JWT complet, 1 jour)
```

> Ce challenge-response prouve la possession de la clé privée (et donc du MP) **sans jamais transmettre la KEK ou le MP au serveur**.

---

## 4. Mise à Jour de l'Arbre (UserTree)

```mermaid
sequenceDiagram
    participant U as Navigateur
    participant B as Backend

    Note over U: Après upload ou création de dossier
    U->>B: GET /users/:id → récupère tree_enc_key + encrypted_structure
    U->>U: RSA-OAEP déchiffre tree_enc_key → TEK (en mémoire)
    U->>U: AES-GCM déchiffre encrypted_structure → arbre JSON
    U->>U: Modifie l'arbre (ajout nœud)
    U->>U: AES-GCM(TEK) → nouveau encrypted_structure
    U->>U: Signature RSA → signature
    U->>B: PATCH /users/:id/tree { encrypted_structure, signature }
    B->>B: Vérifie signature avec pub_key de l'utilisateur
    B-->>U: Arbre mis à jour
```

---

## 5. Upload et Chiffrement d'un Fichier

```mermaid
sequenceDiagram
    participant U as Navigateur
    participant B as Backend
    participant C as Cloud (Dropbox / Google Cloud)

    U->>U: generateTEK() → FEK (AES-GCM-256 aléatoire)
    U->>U: AES-GCM(FEK) → Fichier_Chiffré
    U->>U: Signature(Fichier_Chiffré) → signature
    U->>U: RSA-OAEP(pub_key, FEK) → enc_fek
    U->>C: Upload Fichier_Chiffré
    C-->>U: cloud_data (ID/URL)
    U->>B: POST /files { cloud_data, signature, enc_fek }
    B->>B: Vérifie signature avec pub_key
    B->>B: Crée File + FilePermission { enc_fek, read: true, write: true }
    B-->>U: { fileId }
```

---

## 6. Partage d'un Fichier

Le serveur ne voit jamais la FEK en clair — il manipule uniquement des FEK chiffrées par clé publique RSA.

```mermaid
sequenceDiagram
    participant O as Propriétaire
    participant B as Backend
    participant D as Destinataire

    O->>B: GET /users/:destinataireId → pub_key_destinataire
    B-->>O: pub_key_destinataire (SPKI/base64)
    O->>B: GET /files/:fileId/permission → enc_fek_owner
    O->>O: RSA-OAEP déchiffre enc_fek_owner → FEK en clair
    O->>O: RSA-OAEP(pub_key_destinataire, FEK) → enc_fek_destinataire
    O->>B: POST /files/:fileId/share { userId: destinataireId, enc_fek: enc_fek_destinataire, read, write }
    B->>B: Crée FilePermission { enc_fek, read, write }
    B-->>O: 201

    Note over D: Accès au fichier
    D->>B: GET /files/:fileId → enc_fek_destinataire + Fichier_Chiffré
    D->>D: RSA-OAEP déchiffre enc_fek_destinataire → FEK
    D->>D: AES-GCM déchiffre Fichier_Chiffré → fichier en clair
    D->>D: Vérifie signature avec pub_key_owner
```

> **Révocation :** à la révocation d'un accès, le propriétaire regénère une nouvelle FEK, re-chiffre le fichier, et re-distribue la FEK à tous les accès restants. La FEK compromise ne permet plus de déchiffrer le nouveau blob.

---

## 7. Changement de Mot de Passe Maître

Le re-chiffrement se fait entièrement côté client. Le serveur reçoit uniquement les nouveaux artefacts déjà calculés.

```mermaid
sequenceDiagram
    participant U as Navigateur
    participant B as Backend

    U->>U: Saisie du Nouveau MP (NMP)
    U->>U: generateSalt() → nouveau salt_mp
    Note over U: PBKDF2(NMP, nouveau_salt_mp, 600 000 iter, SHA-256) → 512 bits<br/>→ nouvelle KEK_1<br/>→ nouveau auth_hash
    U->>U: AES-GCM déchiffre priv_key_enc_1 (ancienne KEK_1) → clé privée
    U->>U: AES-GCM(nouvelle KEK_1) → nouvelle priv_key_enc_1
    U->>B: POST /auth/change-password { auth_hash, priv_key_enc_1, salt_mp }
    B->>B: Met à jour auth_hash, priv_key_enc_1, salt_mp
    B-->>U: 200 OK
```

> `priv_key_enc_2` et `salt_rc` ne changent pas — ils dépendent du code de récupération (RC), pas du MP.

---

## 8. Récupération de Compte (Code de Récupération)

Permet de restaurer l'accès si l'utilisateur perd son appareil et son mot de passe maître.

```mermaid
sequenceDiagram
    participant U as Nouvel Appareil
    participant B as Backend

    U->>B: GET /users/:id → priv_key_enc_2, salt_rc
    B-->>U: priv_key_enc_2, salt_rc
    U->>U: Saisie du Code de Récupération (RC, 128 bits)
    Note over U: PBKDF2(RC, salt_rc, 600 000 iter, SHA-256) → 256 bits → KEK_2
    U->>U: AES-GCM déchiffre priv_key_enc_2 (KEK_2) → clé privée
    U->>U: Saisie Nouveau MP (NMP)
    U->>U: generateSalt() → nouveau salt_mp
    Note over U: PBKDF2(NMP, nouveau_salt_mp, 600 000 iter, SHA-256) → 512 bits<br/>→ nouvelle KEK_1 + nouveau auth_hash
    U->>U: AES-GCM(nouvelle KEK_1) → nouvelle priv_key_enc_1
    U->>B: POST /auth/change-password { auth_hash, priv_key_enc_1, salt_mp }
    B-->>U: 200 — Accès restauré
```

---

## 9. Double Facteur TOTP

### Activation

```mermaid
sequenceDiagram
    participant U as Navigateur
    participant B as Backend

    U->>B: POST /users/:id/totp/enable { secret, code }
    B->>B: Vérifie le code TOTP (otplib, HMAC-SHA1)
    B->>B: Génère 10 codes de récupération (randomBytes, 8 octets chacun)
    B->>B: Stocke SHA-256(code) dans TotpRecoveryCode
    B->>B: totpEnabled = true, totpSecret = secret
    B-->>U: { recovery_codes: [...] }  ← affichés une seule fois
```

### Connexion avec TOTP

```mermaid
sequenceDiagram
    participant U as Navigateur
    participant B as Backend

    U->>B: POST /auth/login { username, password: auth_hash }
    B-->>U: { totp_required: true, totp_token }  (JWT 5 min)
    U->>B: POST /auth/totp/verify { totp_token, code }
    B->>B: Vérifie totp_token + code TOTP
    B-->>U: { access_token }
```
