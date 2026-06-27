# Cryptographie côté client

Le backend stocke des **chaînes opaques** : c'est donc le front qui définit les
formats — sauf là où le code backend impose une contrainte. Cette page fige ces
décisions.

---

## 1. Formats imposés par le backend

Le flux OIDC challenge/verify dicte le type et l'encodage de la clé. Dans
`src/auth/auth.service.ts` (`createOidcChallenge`), le serveur fait :

```ts
createPublicKey({ key: Buffer.from(user.pub_key, 'base64'), format: 'der', type: 'spki' })
publicEncrypt({ padding: RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, challenge)
```

**Conséquences non négociables :**

- La paire de clés **doit être RSA** (pas EC).
- `pub_key` **doit être** la clé publique au format **SPKI, DER, encodé base64**.
- Le chiffrement asymétrique est **RSA-OAEP avec SHA-256**.

Si on part sur ECC ou un autre encodage, le login OIDC casse.

---

## 2. Choix cryptographiques

| Élément | Choix | Notes |
|---|---|---|
| Paire de clés | **RSA-OAEP, 2048 bits min (4096 conseillé), SHA-256** | `pub_key` = SPKI DER → base64 |
| Signatures | **RSA-PSS** (ou RSASSA-PKCS1) avec SHA-256 | sur `FileVersion.signature` et `UserTree.signature` |
| KDF | **Argon2id** (lib `hash-wasm`) ; fallback PBKDF2-SHA256 (WebCrypto natif) | dérive KEK1/KEK2 et `auth_hash` |
| Chiffrement symétrique | **AES-GCM 256** | FEK (fichiers), TEK (arbre), enveloppe des clés privées ; IV (96 bits) préfixé, le tout en base64 |

---

## 3. Piège WebCrypto : une clé RSA ≠ deux usages

Dans WebCrypto, une `CryptoKey` est liée à **un** algorithme :

- une clé **RSA-OAEP** a les usages `encrypt` / `decrypt` ;
- une clé **RSA-PSS** a les usages `sign` / `verify`.

Une même `CryptoKey` **ne peut pas** chiffrer *et* signer. Comme le backend ne
stocke qu'**une seule** `pub_key` (utilisée en OAEP pour le challenge), la
solution est :

1. générer **une** paire RSA ;
2. exporter le matériel (PKCS8 pour la privée, SPKI pour la publique) ;
3. **réimporter le même matériel sous deux algos** : OAEP (chiffrer/déchiffrer)
   et PSS (signer/vérifier).

Mathématiquement c'est la même clé (mêmes `n`, `e`, `d`), donc `pub_key` reste
unique en base et le challenge OAEP du backend fonctionne.

---

## 4. Séparation `auth_hash` / KEK (important)

`auth_hash` est envoyé au serveur ; la KEK ne doit **jamais** l'être et ne doit
pas pouvoir être dérivée depuis `auth_hash`. On dérive une clé maîtresse, puis on
la *splitte* par HKDF avec des contextes différents :

```
master    = Argon2id(MP, salt_mp)
auth_hash = HKDF(master, info = "auth")   →  envoyé au serveur
KEK1      = HKDF(master, info = "kek")     →  reste dans le navigateur
```

Le serveur ne voit que `auth_hash` (qu'il compare en `timingSafeEqual`) et ne
peut rien en déduire sur KEK1. Même logique pour la clé de récupération
(`salt_rc` → KEK2).

---

## 5. Matériel produit à l'inscription / au setup OIDC

Une fonction haut-niveau `bootstrapAccount(masterPassword)` génère tout ce que le
backend attend (champs de `POST /users` et `POST /auth/oidc/setup`) :

| Champ envoyé | Construction |
|---|---|
| `pub_key` | SPKI DER (base64) de la clé publique RSA |
| `priv_key_enc_1` | AES-GCM(KEK1, PKCS8(privée)) — IV préfixé, base64 |
| `priv_key_enc_2` | AES-GCM(KEK2, PKCS8(privée)) — KEK2 dérivée de la **Recovery Key** |
| `salt_mp`, `salt_rc` | sels aléatoires (base64) |
| `auth_hash` | `HKDF(Argon2id(MP, salt_mp), "auth")` |
| `tree_enc_key` | RSA-OAEP(pub_key, TEK) en base64 — TEK = clé AES-GCM de l'arbre |

La **Recovery Key** est générée aléatoirement, affichée **une seule fois** à
l'utilisateur (à conserver hors-ligne), jamais envoyée au serveur.

---

## 6. Cycle de vie des fichiers (Phase 2)

Pour mémoire (dépend du backend cloud, branche `api-cloud`) :

**Upload** : générer une FEK aléatoire → chiffrer le fichier (AES-GCM) →
chiffrer la FEK avec `pub_key` (RSA-OAEP) → signer le fichier chiffré (RSA-PSS) →
envoyer `fichier_chiffré + enc_fek + signature`.

**Download** : récupérer `enc_fek` + `signature` → télécharger le blob →
**vérifier la signature** → déchiffrer la FEK avec la clé privée → déchiffrer le
fichier.

**Partage** : déchiffrer sa propre `enc_fek` → récupérer la `pub_key` du
destinataire → re-chiffrer la FEK pour lui → envoyer la nouvelle `enc_fek`.
