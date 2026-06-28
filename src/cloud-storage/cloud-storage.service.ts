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
import {
  CloudStorageProvider,
  FileMetadata,
} from './providers/cloud-storage-provider.interface';
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
  signature?: string;
  signedById?: string;
}

export interface FileListItem {
  id: string;
  name: string;
  provider: CloudProvider;
  createdAt: Date;
  mimeType?: string;
}

export interface FolderItem {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  provider: CloudProvider;
}

// Fichier enrichi de sa clé chiffrée (enc_fek) pour permettre le déchiffrement côté client.
export interface BrowseFileItem extends FileListItem {
  folderId: string | null;
  enc_fek: string | null;
  signature: string | null;
  signedBy: {
    id: string;
    username: string;
    sign_pub_key: string | null;
  } | null;
  sharedCount: number;
}

export interface SharedFileItem extends BrowseFileItem {
  owner: {
    id: string;
    username: string;
    email: string;
    sign_pub_key: string | null;
  };
  read: boolean;
  write: boolean;
  manage: boolean;
  sharedAt: Date;
}

export interface FileShareItem {
  userId: string;
  username: string;
  email: string;
  pub_key?: string;
  read: boolean;
  write: boolean;
  manage: boolean;
  grantedAt: Date;
}

interface ReplacementShareKey {
  userId: string;
  enc_fek: string;
}

export interface BrowseResult {
  // Dossier courant (null = racine)
  folder: { id: string; name: string; parentId: string | null } | null;
  // Chemin de la racine jusqu'au dossier courant (fil d'Ariane)
  breadcrumb: { id: string; name: string }[];
  folders: FolderItem[];
  files: BrowseFileItem[];
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
        throw new BadRequestException(
          `Provider inconnu : ${provider as string}`,
        );
    }
  }

  private toOidcProvider(provider: CloudProvider): OidcProvider {
    return provider === 'google-drive'
      ? OidcProvider.GOOGLE
      : OidcProvider.DROPBOX;
  }

  // ─── Connexion d'un stockage (OAuth dédié, découplé du login) ──────────────

  // Renvoie l'URL de consentement OAuth. Le `state` est un JWT court signé portant
  // l'identité de l'utilisateur authentifié (récupérée au callback, hors header).
  async getConnectUrl(
    provider: CloudProvider,
    userId: string,
  ): Promise<string> {
    const state = this.jwtService.sign(
      {
        storageConnect: true,
        sub: userId,
        provider,
      } satisfies StorageConnectState,
      { expiresIn: '10m' },
    );
    return this.getProvider(provider).getConnectAuthUrl(state);
  }

  // Traite le retour OAuth : valide le state, échange le code, et enregistre/MAJ
  // la connexion de stockage (driveScope = stockage activé).
  async handleConnectCallback(
    provider: CloudProvider,
    code: string,
    state: string,
  ): Promise<string> {
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
        throw new ConflictException(
          'Ce compte de stockage est déjà lié à un autre utilisateur',
        );
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
  async getProvidersStatus(
    userId: string,
  ): Promise<Record<CloudProvider, { connected: boolean }>> {
    const conns = await this.prisma.oidcConnection.findMany({
      where: { userId, driveScope: true },
      select: { provider: true },
    });
    const connected = new Set(conns.map((c) => c.provider));
    return {
      'google-drive': { connected: connected.has(OidcProvider.GOOGLE) },
      dropbox: { connected: connected.has(OidcProvider.DROPBOX) },
    };
  }

  async uploadFile(
    provider: CloudProvider,
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string,
    userId: string,
    encFek: string,
    folderId: string | null = null,
    signature?: string,
    replaceFileId?: string | null,
    replaceMode: 'preserve' | 'rotate' = 'preserve',
    replacementShares: ReplacementShareKey[] = [],
  ): Promise<{ fileId: string }> {
    const trimmedName = (fileName ?? '').trim();
    if (!trimmedName)
      throw new BadRequestException('Le nom du fichier est requis');
    const storageProvider = this.getProvider(provider);

    if (replaceFileId) {
      const target = await this.getFileWithPermissionCheck(
        replaceFileId,
        userId,
        'write',
      );
      const previousData = target.cloud_data as unknown as CloudData;
      if (target.folderId !== folderId || previousData.provider !== provider) {
        throw new BadRequestException(
          'Le fichier à remplacer doit être dans le même dossier et le même provider',
        );
      }
      if (replaceMode === 'rotate' && target.ownerId !== userId) {
        throw new ForbiddenException(
          'Seul le propriétaire peut remplacer avec rotation de clé',
        );
      }

      const nameChanged =
        previousData.name.localeCompare(trimmedName, undefined, {
          sensitivity: 'accent',
        }) !== 0;
      const siblingSameNameFiles = (
        await this.prisma.file.findMany({
          where: {
            ownerId: target.ownerId,
            folderId: target.folderId,
            id: { not: target.id },
            cloud_data: { path: ['provider'], equals: provider },
          },
        })
      ).filter((file) => {
        if (file.id === target.id) return false;
        const data = file.cloud_data as unknown as CloudData;
        return (
          data.name.localeCompare(trimmedName, undefined, {
            sensitivity: 'accent',
          }) === 0
        );
      });
      if (nameChanged && siblingSameNameFiles.length > 0) {
        throw new ConflictException(
          'Un fichier avec ce nom existe déjà dans ce dossier',
        );
      }

      let providerId = await storageProvider.replaceFile(
        previousData.providerId,
        fileBuffer,
        mimeType,
        target.ownerId,
      );
      if (nameChanged) {
        if (provider === 'google-drive') {
          await this.googleDriveService.renameItem(
            providerId,
            trimmedName,
            target.ownerId,
          );
        } else {
          providerId = await this.dropboxService.renameItem(
            providerId,
            trimmedName,
            target.ownerId,
          );
        }
      }
      const nextCloudData: CloudData = {
        ...previousData,
        providerId,
        name: trimmedName,
        mimeType,
        signature: signature?.trim() || undefined,
        signedById: signature?.trim() ? userId : undefined,
      };

      const selectedShareUserIds = replacementShares.map(
        (share) => share.userId,
      );
      const permissionUpdates =
        replaceMode === 'rotate'
          ? [
              this.prisma.filePermission.deleteMany({
                where: {
                  fileId: target.id,
                  userId: { notIn: [target.ownerId, ...selectedShareUserIds] },
                },
              }),
              ...replacementShares.map((share) =>
                this.prisma.filePermission.update({
                  where: {
                    fileId_userId: { fileId: target.id, userId: share.userId },
                  },
                  data: { enc_fek: share.enc_fek },
                }),
              ),
            ]
          : [];
      const duplicateFiles = nameChanged ? [] : siblingSameNameFiles;

      await this.prisma.$transaction([
        this.prisma.file.update({
          where: { id: target.id },
          data: { cloud_data: nextCloudData as any },
        }),
        this.prisma.filePermission.upsert({
          where: { fileId_userId: { fileId: target.id, userId } },
          update: { enc_fek: encFek, read: true, grantedById: userId },
          create: {
            fileId: target.id,
            userId,
            enc_fek: encFek,
            read: true,
            write: target.ownerId === userId,
            manage: target.ownerId === userId,
            grantedById: userId,
          },
        }),
        ...permissionUpdates,
      ]);
      for (const duplicate of duplicateFiles) {
        await this.removeFileEverywhere(
          duplicate.id,
          duplicate.cloud_data as unknown as CloudData,
          target.ownerId,
        );
      }

      this.logger.info('File replaced', {
        context: CloudStorageService.name,
        audit: {
          action: 'FILE_REPLACE',
          userId,
          fileId: target.id,
          provider,
          providerId,
        },
      });

      return { fileId: target.id };
    }

    const folder = await this.getOwnedFolder(userId, folderId);
    if (folder && folder.provider !== provider) {
      throw new BadRequestException(
        'Le dossier de destination appartient à un autre provider',
      );
    }
    const parentProviderId = folder?.providerId ?? null;

    const existingFiles =
      (await this.prisma.file.findMany({
        where: {
          ownerId: userId,
          folderId,
          cloud_data: { path: ['provider'], equals: provider },
        },
      })) ?? [];
    const sameNameFile = existingFiles.find((file) => {
      const data = file.cloud_data as unknown as CloudData;
      return (
        data.name.localeCompare(trimmedName, undefined, {
          sensitivity: 'accent',
        }) === 0
      );
    });

    if (sameNameFile) {
      throw new ConflictException(
        'Un fichier avec ce nom existe déjà dans ce dossier',
      );
    }

    const providerId = await storageProvider.uploadFile(
      trimmedName,
      fileBuffer,
      mimeType,
      userId,
      parentProviderId,
    );

    const cloudData: CloudData = {
      provider,
      providerId,
      name: trimmedName,
      mimeType,
      signature: signature?.trim() || undefined,
      signedById: signature?.trim() ? userId : undefined,
    };

    const file = await this.prisma.file.create({
      data: {
        ownerId: userId,
        folderId,
        cloud_data: cloudData as any,
        permissions: {
          create: {
            userId,
            enc_fek: encFek,
            read: true,
            write: true,
            manage: true,
            grantedById: userId,
          },
        },
      },
    });

    this.logger.info('File record created in DB', {
      context: CloudStorageService.name,
      audit: {
        action: 'FILE_UPLOAD',
        userId,
        fileId: file.id,
        provider,
        providerId,
      },
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

    return this.getProvider(data.provider).downloadFile(
      data.providerId,
      file.ownerId,
    );
  }

  async deleteFile(fileId: string, userId: string): Promise<void> {
    const file = await this.getFileWithPermissionCheck(
      fileId,
      userId,
      'manage',
    );
    if (file.ownerId !== userId)
      throw new ForbiddenException(
        'Seul le propriétaire peut supprimer ce fichier',
      );
    await this.removeFileEverywhere(
      file.id,
      file.cloud_data as unknown as CloudData,
      userId,
    );

    this.logger.info('File deleted', {
      context: CloudStorageService.name,
      audit: { action: 'FILE_DELETE', userId, fileId },
    });
  }

  // Supprime un fichier chez le provider PUIS en base. Les FK FilePermission/FileVersion
  // sont en ON DELETE RESTRICT : on retire d'abord les lignes filles dans une transaction.
  private async removeFileEverywhere(
    fileId: string,
    data: CloudData,
    userId: string,
  ): Promise<void> {
    try {
      await this.getProvider(data.provider).deleteFile(data.providerId, userId);
    } catch (e) {
      // Le fichier a pu être supprimé manuellement chez le provider : on nettoie quand même la base.
      this.logger.warn(
        'Provider file delete failed, removing DB record anyway',
        {
          context: CloudStorageService.name,
          fileId,
          error: e instanceof Error ? e.message : String(e),
        },
      );
    }
    await this.prisma.$transaction([
      this.prisma.filePermission.deleteMany({ where: { fileId } }),
      this.prisma.fileVersion.deleteMany({ where: { fileId } }),
      this.prisma.file.delete({ where: { id: fileId } }),
    ]);
  }

  // ─── Navigation par dossiers (arborescence virtuelle) ──────────────────────

  // Vérifie qu'un dossier appartient bien à l'utilisateur et le retourne (null = racine).
  private async getOwnedFolder(userId: string, folderId: string | null) {
    if (!folderId) return;
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
    });
    if (!folder)
      throw new NotFoundException(`Dossier introuvable (id: ${folderId})`);
    if (folder.ownerId !== userId)
      throw new ForbiddenException('Accès refusé à ce dossier');
    return {
      ...folder,
      provider: (folder.provider ?? 'google-drive') as CloudProvider,
    };
  }

  // Vérifie qu'un dossier appartient bien à l'utilisateur (null = racine, toujours OK).
  private async assertFolderOwnership(
    userId: string,
    folderId: string | null,
  ): Promise<void> {
    await this.getOwnedFolder(userId, folderId);
  }

  private async getSigners(
    files: Array<{ cloud_data: unknown }>,
  ): Promise<
    Map<string, { id: string; username: string; sign_pub_key: string | null }>
  > {
    const signerIds = Array.from(
      new Set(
        files.flatMap((file) => {
          const data = file.cloud_data as CloudData;
          return data.signedById ? [data.signedById] : [];
        }),
      ),
    );
    if (!signerIds.length) return new Map();

    const signers = await this.prisma.user.findMany({
      where: { id: { in: signerIds } },
      select: { id: true, username: true, sign_pub_key: true },
    });
    return new Map(signers.map((signer) => [signer.id, signer]));
  }

  // Contenu d'un dossier : sous-dossiers + fichiers (avec enc_fek) + fil d'Ariane.
  async browse(
    userId: string,
    folderId: string | null,
    provider: CloudProvider = 'google-drive',
  ): Promise<BrowseResult> {
    const currentFolder = await this.getOwnedFolder(userId, folderId);
    if (currentFolder && currentFolder.provider !== provider) {
      throw new BadRequestException(
        'Ce dossier appartient à un autre provider',
      );
    }

    const [folders, files] = await Promise.all([
      this.prisma.folder.findMany({
        where: { ownerId: userId, parentId: folderId, provider },
        orderBy: { name: 'asc' },
      }),
      this.prisma.file.findMany({
        where: {
          ownerId: userId,
          folderId,
          cloud_data: { path: ['provider'], equals: provider },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          permissions: { where: { userId }, select: { enc_fek: true } },
          owner: { select: { id: true, username: true, sign_pub_key: true } },
          _count: {
            select: { permissions: { where: { userId: { not: userId } } } },
          },
        },
      }),
    ]);
    const signers = await this.getSigners(files);

    let current: { id: string; name: string; parentId: string | null } | null =
      null;
    const breadcrumb: { id: string; name: string }[] = [];
    if (folderId) {
      // Remonte la chaîne des parents pour construire le fil d'Ariane.
      let cursor = await this.prisma.folder.findUnique({
        where: { id: folderId },
      });
      current = cursor
        ? { id: cursor.id, name: cursor.name, parentId: cursor.parentId }
        : null;
      while (cursor) {
        breadcrumb.unshift({ id: cursor.id, name: cursor.name });
        cursor = cursor.parentId
          ? await this.prisma.folder.findUnique({
              where: { id: cursor.parentId },
            })
          : null;
      }
    }

    return {
      folder: current,
      breadcrumb,
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        createdAt: f.createdAt,
        provider: f.provider as CloudProvider,
      })),
      files: files.map((f) => {
        const data = f.cloud_data as unknown as CloudData;
        return {
          id: f.id,
          name: data.name,
          provider: data.provider,
          mimeType: data.mimeType,
          createdAt: f.createdAt,
          folderId: f.folderId,
          enc_fek: f.permissions[0]?.enc_fek ?? null,
          signature: data.signature ?? null,
          signedBy: data.signedById
            ? (signers.get(data.signedById) ?? null)
            : null,
          sharedCount: (f as any)._count?.permissions ?? 0,
        };
      }),
    };
  }

  async createFolder(
    userId: string,
    name: string,
    parentId: string | null,
    provider: CloudProvider = 'google-drive',
  ): Promise<FolderItem> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('Le nom du dossier est requis');
    const parent = await this.getOwnedFolder(userId, parentId);
    if (parent && parent.provider !== provider) {
      throw new BadRequestException(
        'Le dossier parent appartient à un autre provider',
      );
    }
    const providerId =
      provider === 'google-drive'
        ? await this.googleDriveService.createFolder(
            trimmed,
            parent?.providerId ?? null,
            userId,
          )
        : await this.dropboxService.createFolder(
            trimmed,
            parent?.providerId ?? null,
            userId,
          );

    const folder = await this.prisma.folder.create({
      data: { ownerId: userId, name: trimmed, parentId, providerId, provider },
    });
    this.logger.info('Folder created', {
      context: CloudStorageService.name,
      audit: { action: 'FOLDER_CREATE', userId, folderId: folder.id },
    });
    return {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      createdAt: folder.createdAt,
      provider: folder.provider as CloudProvider,
    };
  }

  // Renomme (name) et/ou déplace (parentId) un dossier. parentId === null => racine.
  async updateFolder(
    userId: string,
    folderId: string,
    changes: { name?: string; parentId?: string | null },
  ): Promise<FolderItem> {
    const currentFolder = await this.getOwnedFolder(userId, folderId);

    const data: {
      name?: string;
      parentId?: string | null;
      providerId?: string | null;
    } = {};
    let nextParentProviderId: string | null | undefined;

    if (changes.name !== undefined) {
      const trimmed = changes.name.trim();
      if (!trimmed)
        throw new BadRequestException('Le nom du dossier est requis');
      data.name = trimmed;
    }

    if (changes.parentId !== undefined) {
      if (changes.parentId === folderId)
        throw new BadRequestException(
          'Un dossier ne peut pas être son propre parent',
        );
      const nextParent = await this.getOwnedFolder(userId, changes.parentId);
      if (nextParent && nextParent.provider !== currentFolder?.provider) {
        throw new BadRequestException(
          'Impossible de déplacer un dossier vers un autre provider',
        );
      }
      // Empêche les cycles : la cible ne doit pas être un descendant du dossier déplacé.
      if (
        changes.parentId &&
        (await this.isDescendant(changes.parentId, folderId))
      ) {
        throw new BadRequestException(
          "Impossible de déplacer un dossier dans l'un de ses sous-dossiers",
        );
      }
      data.parentId = changes.parentId;
      nextParentProviderId = nextParent?.providerId ?? null;
    }

    if (
      currentFolder?.providerId &&
      currentFolder.provider === 'google-drive' &&
      data.name !== undefined
    ) {
      await this.googleDriveService.renameItem(
        currentFolder.providerId,
        data.name,
        userId,
      );
    }
    if (
      currentFolder?.providerId &&
      currentFolder.provider === 'google-drive' &&
      nextParentProviderId !== undefined
    ) {
      await this.googleDriveService.moveItem(
        currentFolder.providerId,
        nextParentProviderId,
        userId,
      );
    }
    if (
      currentFolder?.providerId &&
      currentFolder.provider === 'dropbox' &&
      data.name !== undefined
    ) {
      data.providerId = await this.dropboxService.renameItem(
        currentFolder.providerId,
        data.name,
        userId,
      );
    }
    if (
      currentFolder?.providerId &&
      currentFolder.provider === 'dropbox' &&
      nextParentProviderId !== undefined
    ) {
      data.providerId = await this.dropboxService.moveItem(
        data.providerId ?? currentFolder.providerId,
        nextParentProviderId,
        userId,
      );
    }

    const folder = await this.prisma.folder.update({
      where: { id: folderId },
      data,
    });
    return {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      createdAt: folder.createdAt,
      provider: folder.provider as CloudProvider,
    };
  }

  // candidate est-il un descendant de ancestor ? (remonte la chaîne des parents)
  private async isDescendant(
    candidateId: string,
    ancestorId: string,
  ): Promise<boolean> {
    let cursor: string | null = candidateId;
    while (cursor) {
      if (cursor === ancestorId) return true;
      const node = await this.prisma.folder.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = node?.parentId ?? null;
    }
    return false;
  }

  // Supprime un dossier et tout son contenu (sous-dossiers + fichiers chez les providers).
  async deleteFolder(userId: string, folderId: string): Promise<void> {
    const folder = await this.getOwnedFolder(userId, folderId);

    // Collecte récursive de tous les dossiers du sous-arbre (BFS).
    const allFolderIds = [folderId];
    const queue = [folderId];
    while (queue.length) {
      const current = queue.shift()!;
      const children = await this.prisma.folder.findMany({
        where: { parentId: current },
        select: { id: true },
      });
      for (const child of children) {
        allFolderIds.push(child.id);
        queue.push(child.id);
      }
    }

    // Supprime d'abord tous les fichiers (provider + base) — sinon ils seraient orphelinés.
    const files = await this.prisma.file.findMany({
      where: { folderId: { in: allFolderIds } },
    });
    for (const file of files) {
      await this.removeFileEverywhere(
        file.id,
        file.cloud_data as unknown as CloudData,
        userId,
      );
    }

    if (folder?.providerId) {
      try {
        await (
          folder.provider === 'dropbox'
            ? this.dropboxService
            : this.googleDriveService
        ).deleteFile(folder.providerId, userId);
      } catch (e) {
        this.logger.warn(
          'Provider folder delete failed, removing DB folder anyway',
          {
            context: CloudStorageService.name,
            folderId,
            error: e instanceof Error ? e.message : String(e),
          },
        );
      }
    }

    // Supprime le dossier racine du sous-arbre : la cascade (parentId ON DELETE CASCADE)
    // efface tous les sous-dossiers.
    await this.prisma.folder.delete({ where: { id: folderId } });

    this.logger.info('Folder deleted (recursive)', {
      context: CloudStorageService.name,
      audit: {
        action: 'FOLDER_DELETE',
        userId,
        folderId,
        fileCount: files.length,
      },
    });
  }

  // Renomme (name) et/ou déplace (folderId) un fichier. folderId === null => racine.
  async updateFile(
    userId: string,
    fileId: string,
    changes: { name?: string; folderId?: string | null },
  ): Promise<void> {
    const file = await this.getFileWithPermissionCheck(fileId, userId, 'write');
    const cloudData = file.cloud_data as unknown as CloudData;

    const data: { cloud_data?: any; folderId?: string | null } = {};
    let nextParentProviderId: string | null | undefined;

    if (changes.name !== undefined) {
      const trimmed = changes.name.trim();
      if (!trimmed)
        throw new BadRequestException('Le nom du fichier est requis');
      const targetFolderId =
        changes.folderId !== undefined ? changes.folderId : file.folderId;
      const siblingFiles =
        (await this.prisma.file.findMany({
          where: {
            ownerId: file.ownerId,
            folderId: targetFolderId,
            id: { not: file.id },
            cloud_data: { path: ['provider'], equals: cloudData.provider },
          },
        })) ?? [];
      const duplicate = siblingFiles.find((sibling) => {
        const siblingData = sibling.cloud_data as unknown as CloudData;
        return (
          siblingData.name.localeCompare(trimmed, undefined, {
            sensitivity: 'accent',
          }) === 0
        );
      });
      if (duplicate) {
        throw new ConflictException(
          'Un fichier avec ce nom existe déjà dans ce dossier',
        );
      }
      data.cloud_data = { ...cloudData, name: trimmed };
    }

    if (changes.folderId !== undefined) {
      const nextFolder = await this.getOwnedFolder(userId, changes.folderId);
      if (nextFolder && nextFolder.provider !== cloudData.provider) {
        throw new BadRequestException(
          'Impossible de déplacer un fichier vers un autre provider',
        );
      }
      data.folderId = changes.folderId;
      nextParentProviderId = nextFolder?.providerId ?? null;
    }

    if (cloudData.provider === 'google-drive' && data.cloud_data?.name) {
      await this.googleDriveService.renameItem(
        cloudData.providerId,
        data.cloud_data.name,
        userId,
      );
    }
    if (
      cloudData.provider === 'google-drive' &&
      nextParentProviderId !== undefined
    ) {
      await this.googleDriveService.moveItem(
        cloudData.providerId,
        nextParentProviderId,
        userId,
      );
    }
    if (cloudData.provider === 'dropbox' && data.cloud_data?.name) {
      cloudData.providerId = await this.dropboxService.renameItem(
        cloudData.providerId,
        data.cloud_data.name,
        userId,
      );
      data.cloud_data = {
        ...data.cloud_data,
        providerId: cloudData.providerId,
      };
    }
    if (
      cloudData.provider === 'dropbox' &&
      nextParentProviderId !== undefined
    ) {
      cloudData.providerId = await this.dropboxService.moveItem(
        cloudData.providerId,
        nextParentProviderId,
        userId,
      );
      data.cloud_data = {
        ...cloudData,
        ...(data.cloud_data ?? {}),
        providerId: cloudData.providerId,
      };
    }

    await this.prisma.file.update({ where: { id: fileId }, data });
    this.logger.info('File updated', {
      context: CloudStorageService.name,
      audit: { action: 'FILE_UPDATE', userId, fileId },
    });
  }

  async shareFile(
    ownerId: string,
    fileId: string,
    recipientUserId: string,
    encFek: string,
    read = true,
    write = false,
    manage = false,
  ): Promise<FileShareItem> {
    const trimmedEncFek = (encFek ?? '').trim();
    if (!trimmedEncFek)
      throw new BadRequestException('La clé de fichier chiffrée est requise');
    const nextRead = read || write || manage;
    if (!nextRead && !write && !manage)
      throw new BadRequestException('Au moins un droit de partage est requis');
    if (recipientUserId === ownerId)
      throw new BadRequestException(
        'Impossible de partager un fichier avec soi-même',
      );

    const [file, recipient] = await Promise.all([
      this.prisma.file.findUnique({ where: { id: fileId } }),
      this.prisma.user.findUnique({
        where: { id: recipientUserId },
        select: { id: true, username: true, email: true },
      }),
    ]);

    if (!file)
      throw new NotFoundException(`Fichier introuvable (id: ${fileId})`);
    if (file.ownerId !== ownerId)
      await this.assertFilePermission(fileId, ownerId, 'manage');
    if (!recipient)
      throw new NotFoundException(
        `Utilisateur introuvable (id: ${recipientUserId})`,
      );
    if (recipientUserId === file.ownerId)
      throw new BadRequestException(
        'Impossible de modifier la permission propriétaire',
      );

    const permission = await this.prisma.filePermission.upsert({
      where: { fileId_userId: { fileId, userId: recipientUserId } },
      update: {
        enc_fek: trimmedEncFek,
        read: nextRead,
        write,
        manage,
        grantedById: ownerId,
      },
      create: {
        fileId,
        userId: recipientUserId,
        enc_fek: trimmedEncFek,
        read: nextRead,
        write,
        manage,
        grantedById: ownerId,
      },
    });

    this.logger.info('File shared', {
      context: CloudStorageService.name,
      audit: {
        action: 'FILE_SHARE',
        ownerId,
        fileId,
        recipientUserId,
        read: nextRead,
        write,
        manage,
      },
    });

    return {
      userId: recipient.id,
      username: recipient.username,
      email: recipient.email,
      read: permission.read,
      write: permission.write,
      manage: permission.manage,
      grantedAt: permission.grantedAt,
    };
  }

  async listFileShares(
    actorId: string,
    fileId: string,
  ): Promise<FileShareItem[]> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file)
      throw new NotFoundException(`Fichier introuvable (id: ${fileId})`);
    if (file.ownerId !== actorId)
      await this.assertFilePermission(fileId, actorId, 'manage');

    const permissions = await this.prisma.filePermission.findMany({
      where: { fileId, userId: { not: file.ownerId } },
      include: {
        user: {
          select: { id: true, username: true, email: true, pub_key: true },
        },
      },
      orderBy: { grantedAt: 'desc' },
    });

    return permissions.map((p) => ({
      userId: p.user.id,
      username: p.user.username,
      email: p.user.email,
      pub_key: p.user.pub_key,
      read: p.read,
      write: p.write,
      manage: p.manage,
      grantedAt: p.grantedAt,
    }));
  }

  async revokeFileShare(
    actorId: string,
    fileId: string,
    recipientUserId: string,
  ): Promise<void> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file)
      throw new NotFoundException(`Fichier introuvable (id: ${fileId})`);
    if (file.ownerId !== actorId)
      await this.assertFilePermission(fileId, actorId, 'manage');
    if (recipientUserId === file.ownerId)
      throw new BadRequestException(
        'Impossible de supprimer la permission propriétaire',
      );
    if (recipientUserId === actorId)
      throw new BadRequestException(
        'Impossible de supprimer vos propres droits de gestion',
      );

    await this.prisma.filePermission.delete({
      where: { fileId_userId: { fileId, userId: recipientUserId } },
    });
  }

  async updateFileShare(
    actorId: string,
    fileId: string,
    recipientUserId: string,
    rights: { read?: boolean; write?: boolean; manage?: boolean },
  ): Promise<FileShareItem> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file)
      throw new NotFoundException(`Fichier introuvable (id: ${fileId})`);
    if (file.ownerId !== actorId)
      await this.assertFilePermission(fileId, actorId, 'manage');
    if (recipientUserId === file.ownerId)
      throw new BadRequestException(
        'Impossible de modifier la permission propriétaire',
      );
    if (recipientUserId === actorId)
      throw new BadRequestException(
        'Impossible de modifier vos propres droits de gestion',
      );

    const existing = await this.prisma.filePermission.findUnique({
      where: { fileId_userId: { fileId, userId: recipientUserId } },
      include: {
        user: {
          select: { id: true, username: true, email: true, pub_key: true },
        },
      },
    });
    if (!existing) throw new NotFoundException('Partage introuvable');

    const write = rights.write ?? existing.write;
    const manage = rights.manage ?? existing.manage;
    const read = (rights.read ?? existing.read) || write || manage;
    if (!read && !write && !manage)
      throw new BadRequestException('Au moins un droit de partage est requis');

    const permission = await this.prisma.filePermission.update({
      where: { fileId_userId: { fileId, userId: recipientUserId } },
      data: { read, write, manage, grantedById: actorId },
      include: {
        user: {
          select: { id: true, username: true, email: true, pub_key: true },
        },
      },
    });

    return {
      userId: permission.user.id,
      username: permission.user.username,
      email: permission.user.email,
      pub_key: permission.user.pub_key,
      read: permission.read,
      write: permission.write,
      manage: permission.manage,
      grantedAt: permission.grantedAt,
    };
  }

  async listSharedWithMe(userId: string): Promise<SharedFileItem[]> {
    const permissions = await this.prisma.filePermission.findMany({
      where: { userId, read: true, file: { ownerId: { not: userId } } },
      include: {
        file: {
          include: {
            owner: {
              select: {
                id: true,
                username: true,
                email: true,
                sign_pub_key: true,
              },
            },
          },
        },
      },
      orderBy: { grantedAt: 'desc' },
    });
    const signers = await this.getSigners(
      permissions.map((permission) => permission.file),
    );

    return permissions.map((permission) => {
      const data = permission.file.cloud_data as unknown as CloudData;
      return {
        id: permission.file.id,
        name: data.name,
        provider: data.provider,
        mimeType: data.mimeType,
        createdAt: permission.file.createdAt,
        folderId: permission.file.folderId,
        enc_fek: permission.enc_fek,
        signature: data.signature ?? null,
        signedBy: data.signedById
          ? (signers.get(data.signedById) ?? null)
          : null,
        sharedCount: 0,
        owner: permission.file.owner,
        read: permission.read,
        write: permission.write,
        manage: permission.manage,
        sharedAt: permission.grantedAt,
      };
    });
  }

  private async assertFilePermission(
    fileId: string,
    userId: string,
    perm: 'read' | 'write' | 'manage',
  ): Promise<void> {
    const permission = await this.prisma.filePermission.findUnique({
      where: { fileId_userId: { fileId, userId } },
    });
    if (!permission || !permission[perm]) {
      throw new ForbiddenException(`Accès refusé au fichier (id: ${fileId})`);
    }
  }

  private async getFileWithPermissionCheck(
    fileId: string,
    userId: string,
    perm: 'read' | 'write' | 'manage',
  ) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file)
      throw new NotFoundException(`Fichier introuvable (id: ${fileId})`);

    if (file.ownerId !== userId) {
      await this.assertFilePermission(fileId, userId, perm);
    }

    return file;
  }

  // Kept for internal use by other modules that still need raw provider metadata
  async listProviderFiles(
    provider: CloudProvider,
    userId: string,
  ): Promise<FileMetadata[]> {
    return this.getProvider(provider).listFiles(userId);
  }
}
