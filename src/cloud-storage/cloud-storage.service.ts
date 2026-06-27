import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { CloudStorageProvider, FileMetadata } from './providers/cloud-storage-provider.interface';
import { GoogleDriveService } from './providers/google-drive.service';
import { DropboxService } from './providers/dropbox.service';
import { PrismaService } from '../prisma.service';
import { OidcProvider } from '../generated/prisma/enums';

export type CloudProvider = 'google-drive' | 'dropbox';

interface StorageConnectState {
  storageConnect: true;
  sub: string;
  provider: CloudProvider;
}

export interface CloudData {
  provider: CloudProvider;
  providerId: string;
  name: string;
  mimeType?: string;
}

export interface FileListItem {
  id: string;
  name: string;
  provider: CloudProvider;
  createdAt: Date;
  mimeType?: string;
}

@Injectable()
export class CloudStorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleDriveService: GoogleDriveService,
    private readonly dropboxService: DropboxService,
    private readonly jwtService: JwtService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  private getProvider(provider: CloudProvider): CloudStorageProvider {
    switch (provider) {
      case 'google-drive':
        return this.googleDriveService;
      case 'dropbox':
        return this.dropboxService;
      default:
        throw new BadRequestException(`Provider inconnu : ${provider}`);
    }
  }

  private toOidcProvider(provider: CloudProvider): OidcProvider {
    return provider === 'google-drive' ? OidcProvider.GOOGLE : OidcProvider.DROPBOX;
  }

  // ─── Connexion d'un stockage (OAuth dédié, découplé du login) ──────────────

  // Renvoie l'URL de consentement OAuth. Le `state` est un JWT court signé portant
  // l'identité de l'utilisateur authentifié (récupérée au callback, hors header).
  async getConnectUrl(provider: CloudProvider, userId: string): Promise<string> {
    const state = this.jwtService.sign(
      { storageConnect: true, sub: userId, provider } satisfies StorageConnectState,
      { expiresIn: '10m' },
    );
    return this.getProvider(provider).getConnectAuthUrl(state);
  }

  // Traite le retour OAuth : valide le state, échange le code, et enregistre/MAJ
  // la connexion de stockage (driveScope = stockage activé).
  async handleConnectCallback(provider: CloudProvider, code: string, state: string): Promise<string> {
    let payload: StorageConnectState;
    try {
      payload = this.jwtService.verify<StorageConnectState>(state);
    } catch {
      throw new UnauthorizedException('State OAuth invalide ou expiré');
    }
    if (!payload.storageConnect || payload.provider !== provider) {
      throw new UnauthorizedException('State OAuth invalide');
    }

    const userId = payload.sub;
    const conn = await this.getProvider(provider).exchangeConnectCode(code);
    const oidcProvider = this.toOidcProvider(provider);

    try {
      await this.prisma.oidcConnection.upsert({
        where: { userId_provider: { userId, provider: oidcProvider } },
        update: {
          providerUserId: conn.providerUserId,
          email: conn.email ?? undefined,
          accessToken: conn.accessToken,
          refreshToken: conn.refreshToken ?? undefined,
          tokenExpiresAt: conn.tokenExpiresAt ?? undefined,
          driveScope: true,
        },
        create: {
          userId,
          provider: oidcProvider,
          providerUserId: conn.providerUserId,
          email: conn.email,
          accessToken: conn.accessToken,
          refreshToken: conn.refreshToken,
          tokenExpiresAt: conn.tokenExpiresAt,
          driveScope: true,
        },
      });
    } catch (e: any) {
      // P2002 : (provider, providerUserId) déjà rattaché à un autre utilisateur.
      if (e?.code === 'P2002') {
        throw new ConflictException('Ce compte de stockage est déjà lié à un autre utilisateur');
      }
      throw e;
    }

    this.logger.info('Storage provider connected', {
      context: CloudStorageService.name,
      audit: { action: 'STORAGE_CONNECT', userId, provider },
    });

    return userId;
  }

  // Indique au front quels stockages sont connectés (pour afficher fichiers vs « connecter »).
  async getProvidersStatus(userId: string): Promise<Record<CloudProvider, { connected: boolean }>> {
    const conns = await this.prisma.oidcConnection.findMany({
      where: { userId, driveScope: true },
      select: { provider: true },
    });
    const connected = new Set(conns.map((c) => c.provider));
    return {
      'google-drive': { connected: connected.has(OidcProvider.GOOGLE) },
      'dropbox': { connected: connected.has(OidcProvider.DROPBOX) },
    };
  }

  async uploadFile(
    provider: CloudProvider,
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string,
    userId: string,
    encFek: string,
  ): Promise<{ fileId: string }> {
    const providerId = await this.getProvider(provider).uploadFile(fileName, fileBuffer, mimeType, userId);

    const cloudData: CloudData = { provider, providerId, name: fileName, mimeType };

    const file = await this.prisma.file.create({
      data: {
        ownerId: userId,
        cloud_data: cloudData as any,
        permissions: {
          create: {
            userId,
            enc_fek: encFek,
            read: true,
            write: true,
            grantedById: userId,
          },
        },
      },
    });

    this.logger.info('File record created in DB', {
      context: CloudStorageService.name,
      audit: { action: 'FILE_UPLOAD', userId, fileId: file.id, provider, providerId },
    });

    return { fileId: file.id };
  }

  async listFiles(userId: string): Promise<FileListItem[]> {
    const files = await this.prisma.file.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
    });

    return files.map((f) => {
      const data = f.cloud_data as unknown as CloudData;
      return {
        id: f.id,
        name: data.name,
        provider: data.provider,
        createdAt: f.createdAt,
        mimeType: data.mimeType,
      };
    });
  }

  async downloadFile(fileId: string, userId: string): Promise<Buffer> {
    const file = await this.getFileWithPermissionCheck(fileId, userId, 'read');
    const data = file.cloud_data as unknown as CloudData;

    this.logger.info('File download', {
      context: CloudStorageService.name,
      audit: { action: 'FILE_DOWNLOAD', userId, fileId },
    });

    return this.getProvider(data.provider).downloadFile(data.providerId, userId);
  }

  async deleteFile(fileId: string, userId: string): Promise<void> {
    const file = await this.getFileWithPermissionCheck(fileId, userId, 'write');
    const data = file.cloud_data as unknown as CloudData;

    await this.getProvider(data.provider).deleteFile(data.providerId, userId);
    await this.prisma.file.delete({ where: { id: fileId } });

    this.logger.info('File deleted', {
      context: CloudStorageService.name,
      audit: { action: 'FILE_DELETE', userId, fileId, provider: data.provider },
    });
  }

  private async getFileWithPermissionCheck(fileId: string, userId: string, perm: 'read' | 'write') {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException(`Fichier introuvable (id: ${fileId})`);

    if (file.ownerId !== userId) {
      const permission = await this.prisma.filePermission.findUnique({
        where: { fileId_userId: { fileId, userId } },
      });
      if (!permission || !permission[perm]) {
        throw new ForbiddenException(`Accès refusé au fichier (id: ${fileId})`);
      }
    }

    return file;
  }

  // Kept for internal use by other modules that still need raw provider metadata
  async listProviderFiles(provider: CloudProvider, userId: string): Promise<FileMetadata[]> {
    return this.getProvider(provider).listFiles(userId);
  }
}
