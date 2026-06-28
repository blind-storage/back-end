import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, drive_v3, Auth } from 'googleapis';
import { Readable } from 'stream';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import {
  CloudStorageProvider,
  FileMetadata,
  StorageConnection,
} from './cloud-storage-provider.interface';
import { PrismaService } from '../../prisma.service';
import { OidcProvider } from '../../generated/prisma/enums';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

@Injectable()
export class GoogleDriveService implements CloudStorageProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  // Client OAuth pour les opérations Drive (le redirect_uri importe peu ici, il sert
  // surtout au refresh ; on réutilise la callback Google principale si aucune
  // callback dédiée au stockage n'est configurée.
  private createOAuthClient(): Auth.OAuth2Client {
    return new google.auth.OAuth2(
      this.configService.getOrThrow('GOOGLE_CLIENT_ID'),
      this.configService.getOrThrow('GOOGLE_SECRET'),
      this.configService.get<string>('GOOGLE_DRIVE_CALLBACK_URL') ??
        this.configService.getOrThrow('GOOGLE_CALLBACK_URL'),
    );
  }

  private isGoogleAuthError(error: unknown): boolean {
    const e = error as {
      code?: number;
      response?: {
        status?: number;
        data?: { error?: string; error_description?: string };
      };
      errors?: Array<{ reason?: string }>;
    };
    const status = e.code ?? e.response?.status;
    const reason = e.errors?.[0]?.reason ?? e.response?.data?.error;
    return (
      status === 401 ||
      reason === 'authError' ||
      reason === 'invalid_grant' ||
      reason === 'invalidCredentials'
    );
  }

  private throwGoogleAuthError(error: unknown, userId: string): never {
    if (this.isGoogleAuthError(error)) {
      this.logger.warn('Google Drive credentials expired or revoked', {
        context: GoogleDriveService.name,
        userId,
      });
      throw new UnauthorizedException(
        'Connexion Google Drive expirée ou révoquée. Reconnectez Google Drive depuis votre compte.',
      );
    }
    throw error;
  }

  // ─── Connexion du stockage Drive (OAuth dédié, découplé du login) ──────────

  async getConnectAuthUrl(state: string): Promise<string> {
    return this.createOAuthClient().generateAuthUrl({
      access_type: 'offline', // => refresh_token
      prompt: 'consent', // force le refresh_token à chaque consentement
      include_granted_scopes: true,
      scope: [DRIVE_SCOPE],
      state,
    });
  }

  async exchangeConnectCode(code: string): Promise<StorageConnection> {
    const client = this.createOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // L'identité du compte Google via l'API Drive (pas besoin de scope profile).
    const drive = google.drive({ version: 'v3', auth: client });
    const about = await drive.about.get({
      fields: 'user(emailAddress,permissionId)',
    });

    if (!tokens.access_token) {
      throw new UnauthorizedException(
        "Google n'a pas renvoyé de token d'accès",
      );
    }

    return {
      providerUserId: about.data.user?.permissionId ?? '',
      email: about.data.user?.emailAddress ?? null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    };
  }

  private async getDrive(userId: string): Promise<drive_v3.Drive> {
    const connection = await this.prisma.oidcConnection.findUnique({
      where: { userId_provider: { userId, provider: OidcProvider.GOOGLE } },
    });

    if (
      !connection?.driveScope ||
      (!connection.accessToken && !connection.refreshToken)
    ) {
      throw new UnauthorizedException(
        `Stockage Google Drive non connecté pour l'utilisateur "${userId}". ` +
          `Connectez-le via GET /cloud-storage/google-drive/connect`,
      );
    }

    const client = this.createOAuthClient();
    client.setCredentials({
      access_token: connection.accessToken,
      refresh_token: connection.refreshToken ?? undefined,
      expiry_date: connection.tokenExpiresAt?.getTime(),
    });

    if (connection.refreshToken) {
      this.logger.info('Refreshing Google OAuth token', {
        context: GoogleDriveService.name,
        userId,
      });
      try {
        const { credentials } = await client.refreshAccessToken();
        const nextRefreshToken =
          credentials.refresh_token ?? connection.refreshToken;
        await this.prisma.oidcConnection.update({
          where: { id: connection.id },
          data: {
            accessToken: credentials.access_token ?? connection.accessToken,
            refreshToken: nextRefreshToken,
            tokenExpiresAt: credentials.expiry_date
              ? new Date(credentials.expiry_date)
              : connection.tokenExpiresAt,
          },
        });
        client.setCredentials({
          ...credentials,
          refresh_token: nextRefreshToken ?? undefined,
        });
      } catch (error) {
        this.throwGoogleAuthError(error, userId);
      }
    }

    return google.drive({ version: 'v3', auth: client });
  }

  private async getOrCreateAppFolder(drive: drive_v3.Drive): Promise<string> {
    const response = await drive.files.list({
      q: `name='Blind Storage' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
      spaces: 'drive',
    });

    if (response.data.files?.length) {
      return response.data.files[0].id!;
    }

    const folder = await drive.files.create({
      requestBody: {
        name: 'Blind Storage',
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });

    return folder.data.id!;
  }

  async uploadFile(
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string,
    userId: string,
    parentId?: string | null,
  ): Promise<string> {
    const drive = await this.getDrive(userId);
    // parentId = dossier Drive miroir ; sinon on retombe sur le dossier app racine.
    const folderId = parentId ?? (await this.getOrCreateAppFolder(drive));

    let response: drive_v3.Schema$File extends never
      ? never
      : { data: drive_v3.Schema$File };
    try {
      response = await drive.files.create({
        requestBody: { name: fileName, parents: [folderId] },
        media: { mimeType, body: Readable.from(fileBuffer) },
        fields: 'id',
      });
    } catch (error) {
      this.throwGoogleAuthError(error, userId);
    }

    this.logger.info('File uploaded to Google Drive', {
      context: GoogleDriveService.name,
      audit: { action: 'GDRIVE_UPLOAD', userId, providerId: response.data.id },
    });
    return response.data.id!;
  }

  async replaceFile(
    providerId: string,
    fileBuffer: Buffer,
    mimeType: string,
    userId: string,
  ): Promise<string> {
    const drive = await this.getDrive(userId);
    try {
      await drive.files.update({
        fileId: providerId,
        media: { mimeType, body: Readable.from(fileBuffer) },
        fields: 'id',
      });
    } catch (error) {
      this.throwGoogleAuthError(error, userId);
    }

    this.logger.info('File replaced in Google Drive', {
      context: GoogleDriveService.name,
      audit: { action: 'GDRIVE_REPLACE', userId, providerId },
    });
    return providerId;
  }

  // ─── Miroir de l'arborescence dans Drive ───────────────────────────────────

  // ID du dossier app racine ("Blind Storage") — parent des dossiers de premier niveau.
  async getRootFolderId(userId: string): Promise<string> {
    return this.getOrCreateAppFolder(await this.getDrive(userId));
  }

  // Crée un dossier Drive sous parentId (ou sous la racine app si null). Retourne son ID Drive.
  async createFolder(
    name: string,
    parentId: string | null,
    userId: string,
  ): Promise<string> {
    const drive = await this.getDrive(userId);
    const parent = parentId ?? (await this.getOrCreateAppFolder(drive));

    let folder: drive_v3.Schema$File extends never
      ? never
      : { data: drive_v3.Schema$File };
    try {
      folder = await drive.files.create({
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parent],
        },
        fields: 'id',
      });
    } catch (error) {
      this.throwGoogleAuthError(error, userId);
    }

    this.logger.info('Folder created in Google Drive', {
      context: GoogleDriveService.name,
      audit: {
        action: 'GDRIVE_FOLDER_CREATE',
        userId,
        providerId: folder.data.id,
      },
    });
    return folder.data.id!;
  }

  // Renomme un fichier OU un dossier Drive.
  async renameItem(
    providerId: string,
    newName: string,
    userId: string,
  ): Promise<void> {
    const drive = await this.getDrive(userId);
    try {
      await drive.files.update({
        fileId: providerId,
        requestBody: { name: newName },
      });
    } catch (error) {
      this.throwGoogleAuthError(error, userId);
    }
  }

  // Déplace un fichier OU un dossier Drive vers newParentId (ou la racine app si null).
  async moveItem(
    providerId: string,
    newParentId: string | null,
    userId: string,
  ): Promise<void> {
    const drive = await this.getDrive(userId);
    const parent = newParentId ?? (await this.getOrCreateAppFolder(drive));

    let current: { data: drive_v3.Schema$File };
    try {
      current = await drive.files.get({
        fileId: providerId,
        fields: 'parents',
      });
    } catch (error) {
      this.throwGoogleAuthError(error, userId);
    }
    const previousParents = (current.data.parents ?? []).join(',');

    try {
      await drive.files.update({
        fileId: providerId,
        addParents: parent,
        removeParents: previousParents || undefined,
        fields: 'id',
      });
    } catch (error) {
      this.throwGoogleAuthError(error, userId);
    }
  }

  async downloadFile(fileId: string, userId: string): Promise<Buffer> {
    const drive = await this.getDrive(userId);
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(response.data as ArrayBuffer);
  }

  async deleteFile(fileId: string, userId: string): Promise<void> {
    const drive = await this.getDrive(userId);
    await drive.files.delete({ fileId });
    this.logger.info('File deleted from Google Drive', {
      context: GoogleDriveService.name,
      audit: { action: 'GDRIVE_DELETE', userId, providerId: fileId },
    });
  }

  async listFiles(userId: string): Promise<FileMetadata[]> {
    const drive = await this.getDrive(userId);
    const folderId = await this.getOrCreateAppFolder(drive);

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, size, createdTime, mimeType)',
      spaces: 'drive',
    });

    return (response.data.files ?? []).map((file) => ({
      id: file.id!,
      name: file.name!,
      size: file.size ? parseInt(file.size) : undefined,
      createdAt: file.createdTime ? new Date(file.createdTime) : undefined,
      mimeType: file.mimeType ?? undefined,
    }));
  }
}
