# Architecture Technique

L'architecture est pensée pour séparer la gestion des métadonnées/clés publiques (gérées par notre Backend) du stockage des fichiers chiffrés (délégué aux Clouds Publics).

| Composant | Technologie | Rôle |
| --- | --- | --- |
| **Backend / API** | NestJS (Node.js) | Interface entre les clients et la base de données. Ne voit jamais les données en clair ni les clés privées déchiffrées. |
| **Base de Données** | PostgreSQL + Prisma | Stockage des profils utilisateurs, clés publiques, métadonnées chiffrées. |
| **Stockage de Fichiers** | Dropbox, Google Cloud, etc. | Hébergement des fichiers chiffrés via intégration API. |

---

## Modèle Cryptographique (Zero Knowledge)

La sécurité repose sur une combinaison de cryptographie symétrique (pour la performance) et asymétrique à clé publique (pour le partage et la gestion des identités).

1. **Chiffrement des Fichiers :** Chaque fichier est chiffré avec l'algorithme **AES-GCM** à l'aide d'une clé symétrique unique appelée **FEK** (File Encryption Key), générée côté client à chaque upload.639563V
2. **Stockage de la FEK (chiffrement asymétrique par destinataire) :** La FEK n'est jamais stockée en clair. Pour chaque utilisateur ayant accès au fichier, une entrée `FilePermission` est créée en base contenant la FEK chiffrée avec la **clé publique** de cet utilisateur (`enc_fek`). Seul le détenteur de la clé privée correspondante peut déchiffrer sa propre `enc_fek` pour retrouver la FEK.
3. **Partage de Fichier :** Pour partager un fichier, le propriétaire :
   - Déchiffre sa propre `enc_fek` avec sa clé privée pour obtenir la FEK en clair.
   - Récupère la clé publique du destinataire auprès du backend.
   - Re-chiffre la FEK avec cette clé publique → nouvelle `enc_fek` destinataire.
   - Envoie la nouvelle `enc_fek` au backend, qui crée une entrée `FilePermission` pour le destinataire.
   - Le serveur ne voit jamais la FEK en clair.
4. **Renouvellement des Clés :** La FEK est régénérée à chaque modification des droits d'accès d'un fichier (révocation). Toutes les `enc_fek` existantes sont recalculées et mises à jour par le propriétaire.
5. **Intégrité et Signatures :** À chaque modification d'un fichier, l'auteur signe le fichier chiffré avec sa **clé privée**. La signature est stockée dans `FileVersion` et vérifiée par le backend à la réception. Cela garantit l'authenticité de chaque version.
6. **Gestion des Clés Utilisateurs :**
   - Le backend stocke et distribue les **clés publiques**.
   - Le backend stocke la **clé privée**, mais celle-ci est **chiffrée**.
7. **Protection de la Clé Privée (KEK - Key Encryption Key) :** La clé privée est stockée chiffrée sous deux formes différentes sur le serveur :
   - Chiffrée via une KEK dérivée du **Mot de Passe Maître (MP) + Salt** de l'utilisateur.
   - Chiffrée une seconde fois via une KEK dérivée d'une **Clé de Recouvrement** (Recovery Key) générée à l'inscription, que l'utilisateur doit conserver hors ligne.
8. **Filesystem Virtuel Chiffré (UserTree) :**
   - Chaque utilisateur possède un arbre JSON local représentant son arborescence (dossiers, fichiers, métadonnées).
   - Cet arbre est chiffré côté client avec une clé symétrique dédiée appelée **TEK** (Tree Encryption Key), générée à l'inscription.
   - La TEK est chiffrée avec la clé publique de l'utilisateur (**TEK_Enc**) et stockée avec l'arbre sur le serveur.
   - Le serveur ne voit jamais la structure ni les noms de fichiers.
   - L'arbre chiffré est signé à chaque modification pour garantir son intégrité.
