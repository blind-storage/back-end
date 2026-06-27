# Schémas des Flux Cryptographiques

## 1. Inscription et Génération des Clés

Ce flux garantit que le serveur ne connaît jamais le mot de passe ni la clé privée de l'utilisateur.

```mermaid
sequenceDiagram
    participant U as Utilisateur (App/Web)
    participant B as Backend (NestJS)
    participant DB as PostgreSQL

    U->>U: Saisie Mot de Passe Maître (MP)
    U->>U: Génération Salt_MP et Salt_RC aléatoires
    U->>U: Dérivation (KDF): MP + Salt_MP = KEK_1
    U->>U: Dérivation (KDF): MP + Salt_MP = auth_hash  (envoyé au serveur pour l'auth locale)
    U->>U: Génération Clé de Recouvrement (RC)
    U->>U: Dérivation (KDF): RC + Salt_RC = KEK_2
    U->>U: Génération paire (Clé Publique / Clé Privée)
    U->>U: Chiffrement Clé Privée avec KEK_1 -> Priv_Enc1
    U->>U: Chiffrement Clé Privée avec KEK_2 -> Priv_Enc2
    U->>U: Génération TEK (AES-256 aléatoire)
    U->>U: Chiffrement TEK avec Clé Publique -> TEK_Enc
    U->>U: Création arbre vide JSON -> Chiffrement avec TEK -> Blob_0
    U->>U: Signature Blob_0 avec Clé Privée
    U->>B: POST /users<br/>{ username, email, auth_hash,<br/>  pub_key, priv_key_enc_1, priv_key_enc_2,<br/>  salt_mp, salt_rc, tree_enc_key }
    B->>DB: Sauvegarde User (auth_hash stocké tel quel)
    B-->>U: 201 — Confirmation & demande de sauvegarde RC offline
```

> `auth_hash` est dérivé **côté client** via KDF. Le serveur le stocke et le compare avec `timingSafeEqual` — il n'effectue aucun hachage supplémentaire.

---

## 2. Mise à Jour de l'Arbre (UserTree)

Ce flux illustre comment l'arbre chiffré est mis à jour après chaque opération (upload, création de dossier, etc.).

```mermaid
sequenceDiagram
    participant U as Utilisateur (App/Web)
    participant B as Backend (NestJS)

    Note over U: Après upload d'un fichier ou création de dossier
    U->>U: Récupération du blob chiffré depuis B
    U->>U: Déchiffrement avec TEK -> Arbre JSON en clair
    U->>U: Modification locale de l'arbre (ajout nœud fichier/dossier)
    U->>U: Re-chiffrement avec TEK -> Nouveau blob chiffré
    U->>U: Signature du blob avec Clé Privée
    U->>B: Envoi (Nouveau blob chiffré, Signature)
    B->>B: Vérification Signature avec Clé Publique de l'U
    B-->>U: Arbre mis à jour
```

---

## 3. Upload et Chiffrement d'un Fichier

Ce flux illustre le chiffrement local avant l'envoi sur le cloud public.

```mermaid
sequenceDiagram
    participant U as Utilisateur (App/Web)
    participant B as Backend (NestJS)
    participant C as Cloud Public (Dropbox/GCP)

    U->>U: Sélection du Fichier en clair
    U->>U: Génération d'une nouvelle FEK (AES-GCM)
    U->>U: Chiffrement du fichier avec FEK -> Fichier_Chiffré
    U->>U: Signature du Fichier_Chiffré avec Clé Privée
    U->>U: Chiffrement de la FEK avec Clé Publique de l'U -> FEK_Chiffrée
    U->>C: Upload Fichier_Chiffré
    C-->>U: Retour de l'URL/ID du Fichier
    U->>B: Envoi Métadonnées (URL, Signature, FEK_Chiffrée)
    B->>B: Vérification Signature
    B-->>U: Validation de l'Upload
```

---

## 4. Partage d'un Fichier

Ce flux illustre comment le propriétaire partage un fichier sans que le serveur ne voie jamais la FEK en clair.

```mermaid
sequenceDiagram
    participant O as Propriétaire (Owner)
    participant B as Backend (NestJS)
    participant D as Destinataire

    O->>B: Demande clé publique du Destinataire
    B-->>O: Pub_Key_Destinataire
    O->>O: Déchiffrement enc_fek_owner avec Clé Privée -> FEK en clair
    O->>O: Chiffrement FEK avec Pub_Key_Destinataire -> enc_fek_destinataire
    O->>B: Envoi (fileId, userId_Destinataire, enc_fek_destinataire, droits read/write)
    B->>B: Création FilePermission (enc_fek, read, write)
    B-->>O: Partage confirmé
    Note over D: Lors de l'accès au fichier
    D->>B: Récupération enc_fek + Fichier_Chiffré
    B-->>D: enc_fek_destinataire + Fichier_Chiffré
    D->>D: Déchiffrement enc_fek_destinataire avec Clé Privée -> FEK
    D->>D: Déchiffrement Fichier_Chiffré avec FEK -> Fichier en clair
    D->>D: Vérification Signature avec Pub_Key_Owner
```

---

## 5. Changement de Mot de Passe Maître

Le serveur ne participe pas au re-chiffrement — il reçoit uniquement les nouveaux artefacts déjà calculés.

```mermaid
sequenceDiagram
    participant U as Utilisateur (App/Web)
    participant B as Backend (NestJS)

    U->>U: Saisie du Nouveau Mot de Passe Maître (NMP)
    U->>U: Génération d'un nouveau Salt_MP
    U->>U: Dérivation: NMP + nouveau_Salt_MP = nouvelle KEK_1
    U->>U: Dérivation: NMP + nouveau_Salt_MP = nouveau auth_hash
    U->>U: Déchiffrement Priv_Enc1 avec ancienne KEK_1 -> Clé Privée en clair
    U->>U: Re-chiffrement Clé Privée avec nouvelle KEK_1 -> nouvelle Priv_Enc1
    U->>B: POST /auth/change-password<br/>{ auth_hash, priv_key_enc_1, salt_mp }
    B->>B: Met à jour auth_hash, priv_key_enc_1, salt_mp
    B-->>U: 200 OK
```

> `priv_key_enc_2` et `salt_rc` ne changent pas — ils dépendent du code de récupération, pas du MP.

---

## 6. Récupération de Compte (Perte de Terminal)

Ce flux montre comment un utilisateur récupère son accès s'il perd son appareil et son mot de passe.

```mermaid
sequenceDiagram
    participant U as Nouvel Appareil (App)
    participant B as Backend (NestJS)

    U->>B: Demande de récupération de compte (ID/Email)
    B-->>U: Envoi (Priv_Enc2, Salt)
    U->>U: Saisie de la Clé de Recouvrement (Recovery Key) par l'U
    U->>U: Dérivation: RC + Salt = KEK_2
    U->>U: Déchiffrement: Priv_Enc2 avec KEK_2 -> Clé Privée en clair
    U->>U: Définition Nouveau Mot de Passe Maître (NMP)
    U->>U: Dérivation: NMP + Salt = Nouvelle KEK_1
    U->>U: Chiffrement de la Clé Privée avec Nouvelle KEK_1 -> Nouvelle_Priv_Enc1
    U->>B: Envoi Nouvelle_Priv_Enc1 pour mise à jour
    B-->>U: Accès restauré et compte sécurisé
```
