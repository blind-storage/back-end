# Inventaire des Algorithmes Cryptographiques

Ce document recense tous les algorithmes et paramètres cryptographiques utilisés dans Blind Storage, côté client (Web Crypto API) et côté serveur (Node.js `crypto`).

---

## Tableau récapitulatif

| # | Algorithme | Usage | Implémentation | Taille de clé / Paramètres |
|---|---|---|---|---|
| 1 | **PBKDF2** | Dérivation KEK_1 + auth_hash depuis le MP | Web Crypto API | SHA-256 · 600 000 iter · salt 256 bits · sortie 512 bits |
| 2 | **PBKDF2** | Dérivation KEK_2 depuis le code de récupération | Web Crypto API | SHA-256 · 600 000 iter · salt 256 bits · sortie 256 bits |
| 3 | **AES-GCM** | Chiffrement de la clé privée (KEK wrapping) | Web Crypto API | Clé 256 bits · IV 96 bits aléatoire · tag 128 bits |
| 4 | **AES-GCM** | Chiffrement du contenu des fichiers (FEK) | Web Crypto API | Clé 256 bits · IV 96 bits aléatoire · tag 128 bits |
| 5 | **AES-GCM** | Chiffrement de l'arbre UserTree (TEK) | Web Crypto API | Clé 256 bits · IV 96 bits aléatoire · tag 128 bits |
| 6 | **RSA-OAEP** | Chiffrement des FEK et du TEK par clé publique | Web Crypto API | Modulaire 2048 bits · exposant 65537 · OAEP SHA-256 |
| 7 | **RSA-OAEP** | Challenge OIDC (serveur → client) | Node.js `crypto` | Modulaire 2048 bits · OAEP SHA-256 · nonce 256 bits |
| 8 | **CSPRNG** | Génération des sels, IV, TEK, FEK, nonce | Web Crypto / Node.js | `crypto.getRandomValues` / `randomBytes` |
| 9 | **SHA-256** | Hachage des codes de récupération TOTP | Node.js `createHash` | Sortie 256 bits (hex) |
| 10 | **TOTP** (HOTP) | Double facteur (authentification) | otplib (HMAC-SHA1) | Secret base32 · fenêtre 30 s · codes 6 chiffres |
| 11 | **JWT / HS256** | Tokens de session, tokens intermédiaires | @nestjs/jwt | Secret `JWT_SECRET` (variable d'environnement) |
| 12 | **timingSafeEqual** | Comparaison à temps constant (auth_hash, nonce) | Node.js `crypto` | Prévient les attaques timing |

---

## Détails par algorithme

### 1 & 2 — PBKDF2

```
Fonction    : PBKDF2 (Password-Based Key Derivation Function 2)
Standard    : RFC 8018
Implémentation : Web Crypto API (SubtleCrypto.deriveBits)

Paramètres communs :
  hash      : SHA-256
  iterations: 600 000  (recommandation OWASP 2024 pour SHA-256)
  sel       : 32 octets (256 bits), CSPRNG

Dérivation mot de passe maître :
  entrée    : MP (UTF-8) + salt_mp
  sortie    : 512 bits
    → octets  0-31 : KEK_1 (importée comme AES-GCM-256)
    → octets 32-63 : auth_hash (base64, envoyé au serveur pour l'authentification)

Dérivation code de récupération :
  entrée    : RC (UTF-8, format XXXX-XXXX×8) + salt_rc
  sortie    : 256 bits → KEK_2 (importée comme AES-GCM-256)
```

### 3, 4, 5 — AES-GCM

```
Algorithme  : AES en mode GCM (Galois/Counter Mode)
Standard    : NIST SP 800-38D
Implémentation : Web Crypto API (SubtleCrypto.encrypt / decrypt)

Taille de clé : 256 bits
IV (nonce)    : 96 bits (12 octets), CSPRNG, unique par chiffrement
Tag d'auth.   : 128 bits (intégré au chiffré par le navigateur)
Format stocké : base64(iv) + ":" + base64(ciphertext+tag)

Clés utilisées :
  KEK_1      → chiffre priv_key_enc_1 (PKCS8 de la clé privée RSA)
  KEK_2      → chiffre priv_key_enc_2
  TEK        → chiffre UserTree.encrypted_structure
  FEK        → chiffre le contenu de chaque fichier

Génération des clés symétriques :
  TEK : SubtleCrypto.generateKey({ name: "AES-GCM", length: 256 }, extractable: true)
  FEK : idem, générée côté client à chaque nouvel upload
```

### 6 & 7 — RSA-OAEP

```
Algorithme  : RSA avec OAEP (Optimal Asymmetric Encryption Padding)
Standard    : RFC 8017 (PKCS#1 v2.2)
Implémentation :
  Client  : Web Crypto API (SubtleCrypto.generateKey / encrypt / decrypt)
  Serveur : Node.js crypto.publicEncrypt (RSA_PKCS1_OAEP_PADDING)

Paramètres de la paire de clés :
  Taille du module : 2048 bits
  Exposant public  : 65537 (0x010001)
  Hash OAEP        : SHA-256
  Extractable      : true (export SPKI/PKCS8)

Formats d'export :
  Clé publique  : SPKI (SubjectPublicKeyInfo), encodée base64 → stockée dans pub_key
  Clé privée    : PKCS8, encodée base64 → chiffrée par AES-GCM avant stockage

Usages :
  Chiffrement TEK   : RSA-OAEP(pub_key, raw bytes du TEK)  → tree_enc_key
  Chiffrement FEK   : RSA-OAEP(pub_key_destinataire, raw bytes FEK) → enc_fek
  Challenge OIDC    : Node.js publicEncrypt(pub_key, randomBytes(32)) → encrypted_challenge
```

### 8 — CSPRNG

```
Client  : window.crypto.getRandomValues(Uint8Array)
Serveur : Node.js crypto.randomBytes(n)

Utilisations :
  salt_mp, salt_rc : 32 octets chacun
  IV AES-GCM       : 12 octets (par opération de chiffrement)
  TEK, FEK         : 32 octets (via generateKey)
  Nonce OIDC       : 32 octets (côté serveur)
  Code de récupération TOTP : 8 octets → 4 groupes de 4 hex
  Code de récupération MP   : 16 octets → 8 groupes de 4 hex (côté client)
```

### 9 — SHA-256 (codes TOTP)

```
Algorithme    : SHA-256
Implémentation: Node.js crypto.createHash('sha256')
Usage         : Hachage des codes de récupération TOTP avant stockage en DB
Format stocké : hex (64 caractères)
Comparaison   : par hash uniquement — les codes en clair ne sont jamais persistés
```

### 10 — TOTP

```
Standard      : RFC 6238 (TOTP), RFC 4226 (HOTP)
Bibliothèque  : otplib v13 avec NobleCryptoPlugin + ScureBase32Plugin
Hash interne  : HMAC-SHA1
Pas de temps  : 30 secondes
Longueur      : 6 chiffres
Format secret : base32

Codes de récupération TOTP :
  Génération : randomBytes(8).toString('hex').toUpperCase() → 4 groupes de 4 hex
  Format     : XXXX-XXXX-XXXX-XXXX
  Quantité   : 10 codes par utilisateur
  Stockage   : SHA-256(code.toUpperCase()) dans TotpRecoveryCode
  Usage      : à usage unique (champ usedAt marqué à la consommation)
```

### 11 — JWT (HS256)

```
Standard      : RFC 7519
Bibliothèque  : @nestjs/jwt (jsonwebtoken)
Algorithme    : HS256 (HMAC-SHA256)
Secret        : variable d'environnement JWT_SECRET

Tokens émis par le serveur :
  access_token     : durée 1 jour  · payload: { sub, email, username, role }
  totp_token       : durée 5 min   · payload: { totpPending, sub }
  pending_token    : durée 10 min  · payload: { oidcPending, sub, username }
  nonce_token      : durée 5 min   · payload: { oidcNonce, sub, nonce }
  setup_token      : durée 15 min  · payload: { pending, provider, providerUserId, email, ... }
  link_token       : durée 15 min  · payload: { pendingLink, userId, provider, ... }
```

### 12 — timingSafeEqual

```
Implémentation: Node.js crypto.timingSafeEqual(a, b)
Usage :
  Comparaison auth_hash      : connexion locale + link-confirm OIDC
  Comparaison nonce OIDC     : vérification du challenge RSA
Propriété     : temps de comparaison constant (non dépendant des données)
                → protège contre les attaques par analyse de temps (timing attacks)
```

---

## Résumé de la surface cryptographique

```
Côté client (navigateur) :
  Web Crypto API  — AES-GCM-256, RSA-OAEP-2048, PBKDF2/SHA-256, CSPRNG

Côté serveur (Node.js) :
  crypto built-in — RSA-OAEP (publicEncrypt), SHA-256 (createHash),
                    timingSafeEqual, randomBytes (CSPRNG)
  otplib          — TOTP/HOTP (HMAC-SHA1)
  jsonwebtoken    — HS256

Stockage base de données :
  Clés publiques   : SPKI/base64 (en clair — distribuables)
  Clés privées     : PKCS8/AES-GCM (chiffrées — jamais déchiffrables côté serveur)
  TEK chiffré      : RSA-OAEP/base64
  auth_hash        : base64 brut (PBKDF2 client-side, aucun re-hachage serveur)
  Codes TOTP       : SHA-256/hex (jamais en clair)
```

---

## Conformité et références

| Standard | Utilisation dans Blind Storage |
|---|---|
| NIST SP 800-132 | PBKDF2 avec SHA-256, ≥ 210 000 iter pour SHA-1 → 600 000 utilisées |
| NIST SP 800-38D | AES-GCM avec IV 96 bits, tag 128 bits |
| RFC 8017 (PKCS#1 v2.2) | RSA-OAEP avec SHA-256 |
| OWASP Password Storage | PBKDF2-SHA256 à 600 000 iter conforme aux recommandations 2024 |
| RFC 6238 | TOTP (HMAC-SHA1, pas 30 s) |
