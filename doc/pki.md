# Infrastructure à Clés Publiques (PKI)

Blind Storage repose sur une PKI applicative **sans autorité de certification centrale**. Le backend joue le rôle de **serveur de clés publiques** : il distribue les clés publiques des utilisateurs mais ne peut pas les générer, les révoquer unilatéralement, ni les déchiffrer.

---

## Architecture des Clés

Chaque utilisateur dispose de **deux paires de clés RSA distinctes** (selon le schéma Prisma) :

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
├─ chiffre → FEK → enc_fek (par fichier, par utilisateur)
├─ chiffre → TEK → tree_enc_key
└─ chiffre → nonce OIDC (challenge serveur)

TEK (AES-GCM-256, généré à l'inscription)
└─ chiffre → UserTree.encrypted_structure

FEK (AES-GCM-256, généré par fichier)
└─ chiffre → contenu du fichier (stocké sur cloud tiers)
```

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

### Clé de signature (schéma présent, implémentation à venir)

| Champ | Type | Description |
|---|---|---|
| `sign_pub_key` | `String?` | Clé publique de signature (SPKI/base64) |
| `sign_priv_key_enc_1` | `String?` | Clé privée de signature chiffrée par KEK_1 |
| `sign_priv_key_enc_2` | `String?` | Clé privée de signature chiffrée par KEK_2 |
| `key_certificate` | `Json?` | Certificat de clé (format JSON, structure à définir) |
| `key_certificate_signature` | `String?` | Signature du certificat (auto-signée ou par un admin) |
| `key_fingerprint` | `String?` | Empreinte de la clé publique (pour identification rapide) |

---

## Rôle du Serveur comme Key Server

Le backend est un **serveur de clés publiques non-certifié** :

- **Distribue** `pub_key` à tout utilisateur authentifié via `GET /users/:id`.
- **Stocke** les clés privées **chiffrées** uniquement — ne peut pas les déchiffrer.
- **Vérifie** les signatures sur les blobs et les arborescences pour garantir l'intégrité (le serveur ne peut pas forger de signatures sans la clé privée du client).
- **Chiffre** les challenges OIDC avec la `pub_key` de l'utilisateur via `node:crypto.publicEncrypt` (RSA-OAEP, SHA-256).

### Modèle de confiance

```
Utilisateur A  ──── pub_key_A (en clair) ───►  Backend
                                                    │
Utilisateur B  ◄─── pub_key_A ────────────────────┘
    │
    └─ RSA-OAEP(pub_key_A, FEK) → enc_fek envoyé au backend
                                        │
Utilisateur A  ◄─── enc_fek ────────────┘
    └─ RSA-OAEP déchiffre avec priv_key_A → FEK → fichier
```

> Le backend ne peut pas lire `enc_fek` car il ne détient pas `priv_key_A` en clair. La confiance repose sur l'authenticité de `pub_key_A` distribuée par le serveur — un attaquant contrôlant la DB pourrait substituer une clé publique (TOFU attack). Des certificats (`key_certificate`) sont prévus pour mitiger ce risque.

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
