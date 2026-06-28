import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Dropbox, DropboxAuth } from 'dropbox';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { CloudStorageProvider, FileMetadata, StorageConnection } from './cloud-storage-provider.interface';
import { PrismaService } from '../../prisma.service';
import { OidcProvider } from '../../generated/prisma/enums';

const DROPBOX_SCOPES = [
  'account_info.read',
  'files.metadata.read',
  'files.metadata.write',
  'files.content.write',
  'files.content.read',
];

@Injectable()
export class DropboxService implements CloudStorageProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  // ─── Connexion du stockage Dropbox (OAuth dédié, découplé du login) ────────

  private createAuth(): DropboxAuth {
    return new DropboxAuth({
      clientId: this.configService.getOrThrow('DROPBOX_CLIENT_ID'),
      clientSecret: this.configService.getOrThrow('DROPBOX_CLIENT_SECRET'),
    });
  }

  async getConnectAuthUrl(state: string): Promise<string> {
    const redirectUri = this.configService.getOrThrow<string>('DROPBOX_STORAGE_CALLBACK_URL');
    const url = await this.createAuth().getAuthenticationUrl(
      redirectUri,
      state,
      'code',
      'offline',          // => refresh_token
      DROPBOX_SCOPES,
      'none',
      false,
    );
    return String(url);
  }

  async exchangeConnectCode(code: string): Promise<StorageConnection> {
    const redirectUri = this.configService.getOrThrow<string>('DROPBOX_STORAGE_CALLBACK_URL');
    const res = await this.createAuth().getAccessTokenFromCode(redirectUri, code);
    const r = res.result as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      account_id: string;
    };

    return {
      providerUserId: r.account_id,
      email: null,
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? null,
      tokenExpiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : null,
    };
  }

  private async getClient(userId: string): Promise<Dropbox> {
    const connection = await this.prisma.oidcConnection.findUnique({
      where: { userId_provider: { userId, provider: OidcProvider.DROPBOX } },
    });

    if (!connection?.accessToken || !connection.driveScope) {
      throw new UnauthorizedException(
        `Stockage Dropbox non connecté pour l'utilisateur "${userId}". ` +
          `Connectez-le via GET /cloud-storage/dropbox/connect`,
      );
    }

    return new Dropbox({
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken ?? undefined,
      accessTokenExpiresAt: connection.tokenExpiresAt ?? undefined,
      clientId: this.configService.getOrThrow('DROPBOX_CLIENT_ID'),
      clientSecret: this.configService.getOrThrow('DROPBOX_CLIENT_SECRET'),
    });
  }

  private buildPath(fileName?: string): string {
    return fileName ? `/Blind Storage/${fileName}` : '/Blind Storage';
  }

  private joinPath(parentPath: string, name: string): string {
    return `${parentPath.replace(/\/$/, '')}/${name}`;
  }

  private basename(path: string): string {
    return path.split('/').filter(Boolean).pop() ?? path;
  }

  private dirname(path: string): string {
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    return parts.length ? `/${parts.join('/')}` : '';
  }

  private async ensureRootFolder(dbx: Dropbox): Promise<string> {
    const path = this.buildPath();
    try {
      await dbx.filesGetMetadata({ path });
    } catch {
      await dbx.filesCreateFolderV2({ path, autorename: false });
    }
    return path;
  }

  async uploadFile(
    fileName: string,
    fileBuffer: Buffer,
    _mimeType: string,
    userId: string,
    parentId?: string | null,
  ): Promise<string> {
    const dbx = await this.getClient(userId);
    const parentPath = parentId ?? (await this.ensureRootFolder(dbx));
    const path = this.joinPath(parentPath, fileName);

    const response = await dbx.filesUpload({
      path,
      contents: fileBuffer,
      mode: { '.tag': 'overwrite' },
    });

    this.logger.info('File uploaded to Dropbox', {
      context: DropboxService.name,
      audit: { action: 'DROPBOX_UPLOAD', userId, path: response.result.path_display },
    });
    return response.result.path_display!;
  }

  async replaceFile(
    providerId: string,
    fileBuffer: Buffer,
    _mimeType: string,
    userId: string,
  ): Promise<string> {
    const dbx = await this.getClient(userId);
    const response = await dbx.filesUpload({
      path: providerId,
      contents: fileBuffer,
      mode: { '.tag': 'overwrite' },
    });

    this.logger.info('File replaced in Dropbox', {
      context: DropboxService.name,
      audit: { action: 'DROPBOX_REPLACE', userId, path: response.result.path_display },
    });
    return response.result.path_display ?? providerId;
  }

  async createFolder(name: string, parentId: string | null, userId: string): Promise<string> {
    const dbx = await this.getClient(userId);
    const parentPath = parentId ?? (await this.ensureRootFolder(dbx));
    const path = this.joinPath(parentPath, name);
    const response = await dbx.filesCreateFolderV2({ path, autorename: false });
    return response.result.metadata.path_display ?? path;
  }

  async renameItem(providerId: string, newName: string, userId: string): Promise<string> {
    const dbx = await this.getClient(userId);
    const parentPath = this.dirname(providerId);
    const toPath = this.joinPath(parentPath, newName);
    const response = await dbx.filesMoveV2({
      from_path: providerId,
      to_path: toPath,
      autorename: false,
    });
    return response.result.metadata.path_display ?? toPath;
  }

  async moveItem(providerId: string, newParentId: string | null, userId: string): Promise<string> {
    const dbx = await this.getClient(userId);
    const parentPath = newParentId ?? (await this.ensureRootFolder(dbx));
    const toPath = this.joinPath(parentPath, this.basename(providerId));
    const response = await dbx.filesMoveV2({
      from_path: providerId,
      to_path: toPath,
      autorename: false,
    });
    return response.result.metadata.path_display ?? toPath;
  }

  async downloadFile(fileId: string, userId: string): Promise<Buffer> {
    const dbx = await this.getClient(userId);
    const response = await dbx.filesDownload({ path: fileId });
    return (response.result as any).fileBinary as Buffer;
  }

  async deleteFile(fileId: string, userId: string): Promise<void> {
    const dbx = await this.getClient(userId);
    await dbx.filesDeleteV2({ path: fileId });
    this.logger.info('File deleted from Dropbox', {
      context: DropboxService.name,
      audit: { action: 'DROPBOX_DELETE', userId, path: fileId },
    });
  }

  async listFiles(userId: string): Promise<FileMetadata[]> {
    const dbx = await this.getClient(userId);
    const path = await this.ensureRootFolder(dbx);

    try {
      const response = await dbx.filesListFolder({ path });
      return response.result.entries
        .filter((entry) => entry['.tag'] === 'file')
        .map((entry) => ({
          id: (entry as any).path_display as string,
          name: entry.name,
          size: (entry as any).size as number | undefined,
          mimeType: undefined,
        }));
    } catch {
      return [];
    }
  }
}
