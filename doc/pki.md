# Infrastructure à Clés Publiques (PKI)

Blind Storage dispose d'une PKI applicative avec une **CA (Certificate Authority) interne** signant les clés publiques RSA des utilisateurs. Cela permet à n'importe quel client de vérifier l'authenticité d'une clé publique sans faire confiance au serveur au moment de la vérification.

---

## Architecture des Clés

Chaque utilisateur dispose de **deux paires de clés RSA distinctes** :

| Paire | Algorithme | Usage |
|---|---|---|
| **Chiffrement** (`pub_key` / `priv_key_enc_*`) | RSA-OAEP 2048 bits, SHA-256 | Chiffrer les FEK et le TEK, déchiffrement des challenges OIDC |
| **Signature** (`sign_pub_key` / `sign_priv_key_enc_*`) | Planifié (schéma présent) | Signer les fichiers et l'arbre, vérification d'intégrité |

> La séparation chiffrement/signature suit le principe de **moindre privilège cryptographique** : une clé compromise ne compromet qu'une seule capacité.

---

## Hiérarchie des Clés

```
Mot de Passe Maître (MP)
│
├─ PBKDF2(MP, salt_mp, 600k, SHA-256) → 512 bits
│   ├─ bits  0-255 → KEK_1 (AES-GCM-256)
│   │   └─ chiffre → priv_key_enc_1  (stocké en DB)
│   └─ bits 256-511 → auth_hash       (stocké en DB, compare timingSafeEqual)
│
Code de Récupération (RC, 128 bits aléatoires)
│
└─ PBKDF2(RC, salt_rc, 600k, SHA-256) → 256 bits → KEK_2 (AES-GCM-256)
    └─ chiffre → priv_key_enc_2  (stocké en DB)

Clé Privée RSA (en clair uniquement en mémoire RAM client)
├─ déchiffre → enc_fek (FilePermission) → FEK → fichier
└─ déchiffre → tree_enc_key → TEK → arbre UserTree

Clé Publique RSA (stockée en clair en DB, distribuée librement)
├─ certifiée par la CA → key_certificate + key_certificate_signature
├─ chiffre → FEK → enc_fek (par fichier, par utilisateur)
├─ chiffre → TEK → tree_enc_key
└─ chiffre → nonce OIDC (challenge serveur)

TEK (AES-GCM-256, généré à l'inscription)
└─ chiffre → UserTree.encrypted_structure

FEK (AES-GCM-256, généré par fichier)
└─ chiffre → contenu du fichier (stocké sur cloud tiers)
```

---

## CA (Certificate Authority)

La CA est une paire de clés **ECDSA P-256** dont la clé privée est stockée uniquement en variable d'environnement (`CA_PRIVATE_KEY`), jamais en base de données.

| Paramètre | Valeur |
|---|---|
| Algorithme | ECDSA P-256 (secp256r1) |
| Hash | SHA-256 |
| Format de signature | IEEE P1363 — 64 octets bruts (r ‖ s) |
| Validité des certificats émis | 2 ans |

> Le format IEEE P1363 (et non DER/ASN.1) est utilisé pour être directement consommable par le Web Crypto API (`subtle.verify`) sans parsing intermédiaire.

---

## Format du Certificat (BlindCertificate)

Format JSON propriétaire (pas X.509). La signature porte sur `JSON.stringify(cert)`.

```json
{
  "version": 1,
  "subject": {
    "id": "uuid-utilisateur",
    "username": "alice",
    "email": "alice@example.com"
  },
  "pub_key": "<clé RSA-OAEP 2048 en SPKI base64>",
  "fingerprint": "<SHA-256 hex de pub_key>",
  "issued_at": "2026-06-29T10:00:00.000Z",
  "expires_at": "2028-06-29T10:00:00.000Z"
}
```

Le certificat est stocké dans le champ `key_certificate` (JSONB) de la table `User` et renvoyé par `GET /users/:id`.

---

## Cycle de Vie d'un Certificat

**Émission** — à la création du compte (inscription classique ou OIDC) :
1. Le client génère une paire RSA-OAEP 2048 côté navigateur.
2. Le client envoie la clé publique au serveur.
3. Le serveur calcule l'empreinte SHA-256, construit le JSON du certificat, le signe avec la clé privée CA.
4. Le certificat, la signature et l'empreinte sont stockés dans la table `User`.

**Révocation** — à la suppression du compte :
1. Le serveur insère l'empreinte dans `RevokedCertificate` (raison : `account_deleted`).
2. Puis supprime le compte.
3. L'entrée de révocation **survit** à la suppression (non cascadée, intentionnel).

---

## CRL (Certificate Revocation List)

La CRL est un JSON signé par la CA, accessible publiquement sans authentification.

```json
{
  "version": 1,
  "issued_at": "2026-06-29T10:00:00.000Z",
  "revoked": [
    {
      "fingerprint": "<SHA-256 hex>",
      "revoked_at": "2026-06-01T...",
      "reason": "account_deleted"
    }
  ]
}
```

La signature de la CRL elle-même est vérifiable côté client — un attaquant ne peut pas forger une CRL vide.

---

## Routes PKI

| Route | Auth | Réponse |
|---|---|---|
| `GET /pki/ca` | Aucune | `{ pub_key: string }` — clé publique CA en PEM |
| `GET /pki/crl` | Aucune | `{ crl: BlindCrl, signature: string }` — CRL signée |
| `GET /users/:id` | JWT | Inclut `key_certificate`, `key_certificate_signature`, `key_fingerprint` |

> Il n'existe pas de route dédiée pour récupérer le certificat d'un utilisateur : il est renvoyé directement dans l'objet `User`.

---

## Vérification Côté Client (Zero-Trust)

La vérification se fait entièrement dans le navigateur via le **Web Crypto API**, sans bibliothèque externe :

1. `GET /pki/ca` → importer la clé publique CA avec `subtle.importKey('spki', ..., { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])`
2. `GET /pki/crl` → vérifier la signature de la CRL avec la clé CA
3. Vérifier la signature du certificat : `subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, caKey, signature, JSON.stringify(cert))`
4. Vérifier que `cert.fingerprint` n'est pas dans `crl.revoked`

---

## Champs PKI dans la Base de Données

### Clé de chiffrement (implémentée)

| Champ | Type | Description |
|---|---|---|
| `pub_key` | `String UNIQUE` | Clé publique RSA-OAEP exportée en SPKI, encodée base64 |
| `priv_key_enc_1` | `String UNIQUE` | Clé privée (PKCS8) chiffrée par KEK_1 (AES-GCM), format `base64(iv):base64(ct)` |
| `priv_key_enc_2` | `String UNIQUE` | Clé privée (PKCS8) chiffrée par KEK_2 (AES-GCM), même format |
| `salt_mp` | `String?` | Sel PBKDF2 pour la dérivation du MP (32 octets, base64) |
| `salt_rc` | `String?` | Sel PBKDF2 pour la dérivation du RC (32 octets, base64) |
| `tree_enc_key` | `String UNIQUE` | TEK chiffré avec `pub_key` via RSA-OAEP (base64) |
| `key_certificate` | `Json?` | BlindCertificate signé par la CA (JSONB) |
| `key_certificate_signature` | `String?` | Signature ECDSA P-256 du certificat (base64, IEEE P1363) |
| `key_fingerprint` | `String?` | SHA-256 hex de `pub_key` (index unique, utilisé pour la CRL) |

### Clé de signature (schéma présent, implémentation à venir)

| Champ | Type | Description |
|---|---|---|
| `sign_pub_key` | `String?` | Clé publique de signature (SPKI/base64) |
| `sign_priv_key_enc_1` | `String?` | Clé privée de signature chiffrée par KEK_1 |
| `sign_priv_key_enc_2` | `String?` | Clé privée de signature chiffrée par KEK_2 |

### Table RevokedCertificate

| Champ | Type | Description |
|---|---|---|
| `id` | `String` | UUID |
| `fingerprint` | `String UNIQUE` | SHA-256 hex de la clé publique révoquée |
| `reason` | `String` | Raison (`account_deleted`, …) |
| `revokedAt` | `DateTime` | Date de révocation |

---

## Modèle de Confiance

```
Utilisateur A  ──── pub_key_A (en clair) ───►  Backend (CA)
                                                    │ signe cert_A
Utilisateur B  ◄─── cert_A + signature ────────────┘
    │
    └─ vérifie signature avec pub_key_CA (GET /pki/ca)
    └─ vérifie fingerprint vs CRL (GET /pki/crl)
    └─ RSA-OAEP(pub_key_A, FEK) → enc_fek envoyé au backend
                                        │
Utilisateur A  ◄─── enc_fek ────────────┘
    └─ RSA-OAEP déchiffre avec priv_key_A → FEK → fichier
```

> Le backend ne peut pas lire `enc_fek` car il ne détient pas `priv_key_A` en clair. La CA garantit l'authenticité de `pub_key_A` — un attaquant contrôlant la DB ne peut pas substituer une clé publique sans invalider la signature CA.

---

## Stockage des Clés Côté Client

| Donnée | Stockage | Durée de vie |
|---|---|---|
| Clé privée RSA (déchiffrée) | RAM (React Context) uniquement | Session navigateur — effacée au rechargement |
| KEK_1 (AES-GCM) | RAM uniquement | Session navigateur |
| JWT (access_token) | `localStorage` | 1 jour (expiration JWT) |
| `salt_mp`, `salt_rc` | `localStorage` (clé : `blind_salt_<username>`) | Persistant |
| `priv_key_enc_1/2` | DB via API | Persistant |

> Les sels ne sont pas des secrets (la sécurité provient du mot de passe, pas du sel). Ils sont stockés localement pour permettre la dérivation de `auth_hash` sans interroger le serveur à chaque connexion.

---

## Flux de Rotation des Clés

### Rotation de KEK (changement de MP)

1. Client dérive une nouvelle KEK_1 avec un nouveau `salt_mp`.
2. Déchiffre `priv_key_enc_1` avec l'ancienne KEK_1.
3. Re-chiffre la clé privée avec la nouvelle KEK_1 → `priv_key_enc_1`.
4. Envoie au serveur `{ auth_hash, priv_key_enc_1, salt_mp }`.
5. `priv_key_enc_2` (liée au RC) et la paire RSA restent inchangées.

### Rotation de la paire RSA (non implémentée)

En cas de compromission de la clé privée RSA :
1. Générer une nouvelle paire RSA.
2. Récupérer toutes les `enc_fek` existantes, les re-chiffrer avec la nouvelle clé publique.
3. Re-chiffrer le `tree_enc_key`.
4. Envoyer l'ensemble au serveur en une transaction.

> Cette opération est coûteuse O(n fichiers) et nécessite que le client déchiffre chaque FEK avec l'ancienne clé privée avant de la re-chiffrer. Elle n'est pas encore implémentée.

---

## Modèle de Partage et FilePermission

Chaque accès à un fichier est matérialisé par une entrée `FilePermission` :

```
FilePermission {
  fileId      → référence le fichier
  userId      → utilisateur ayant accès
  enc_fek     → FEK chiffrée avec pub_key de cet utilisateur
  read        → droit lecture
  write       → droit écriture
  grantedById → qui a accordé l'accès
}
```

La FEK est chiffrée **individuellement** pour chaque destinataire. Le serveur stocke N exemplaires de `enc_fek` pour N utilisateurs ayant accès, sans jamais voir la FEK en clair.
