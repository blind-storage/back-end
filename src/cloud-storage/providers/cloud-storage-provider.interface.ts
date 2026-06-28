export interface FileMetadata {
  id: string;
  name: string;
  size?: number;
  createdAt?: Date;
  mimeType?: string;
}

// Résultat de l'échange du code OAuth lors de la connexion d'un stockage.
export interface StorageConnection {
  providerUserId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}

// Contrat commun à tous les providers de stockage.
// Chaque méthode reçoit userId car les opérations sont toujours liées à un utilisateur
// (authentification OAuth2 par utilisateur pour Google Drive, organisation par dossier pour Dropbox).
export interface CloudStorageProvider {
  uploadFile(
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string,
    userId: string,
    parentId?: string | null, // dossier de destination chez le provider (Google Drive)
  ): Promise<string>; // retourne l'ID du fichier chez le provider

  replaceFile(
    providerId: string,
    fileBuffer: Buffer,
    mimeType: string,
    userId: string,
  ): Promise<string>; // retourne l'ID/path potentiellement mis à jour chez le provider

  downloadFile(fileId: string, userId: string): Promise<Buffer>;

  deleteFile(fileId: string, userId: string): Promise<void>;

  listFiles(userId: string): Promise<FileMetadata[]>;

  // ─── Connexion du stockage (OAuth dédié, découplé du login) ───────────────
  // URL de consentement OAuth (scopes de stockage + accès offline), `state` signé.
  getConnectAuthUrl(state: string): Promise<string>;
  // Échange le code reçu au callback contre des tokens de stockage.
  exchangeConnectCode(code: string): Promise<StorageConnection>;
}
