import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { PrismaService } from '../prisma.service';
import { CloudStorageService } from './cloud-storage.service';
import { DropboxService } from './providers/dropbox.service';
import { GoogleDriveService } from './providers/google-drive.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeFile = (overrides: Record<string, any> = {}) => ({
  id: 'file-uuid-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ownerId: 'user-uuid-1',
  cloud_data: {
    provider: 'google-drive',
    providerId: 'gdrive-id-1',
    name: 'test.pdf',
    mimeType: 'application/pdf',
  },
  ...overrides,
});

const makePermission = (overrides: Record<string, any> = {}) => ({
  id: 'perm-uuid-1',
  fileId: 'file-uuid-1',
  userId: 'user-uuid-2',
  enc_fek: 'enc-key',
  read: true,
  write: false,
  manage: false,
  grantedById: 'user-uuid-1',
  grantedAt: new Date(),
  ...overrides,
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

const prismaMock = {
  file: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  filePermission: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  fileVersion: {
    deleteMany: jest.fn(),
  },
  folder: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  oidcConnection: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  // La suppression fiabilisée retire les lignes filles puis le fichier dans une transaction.
  $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
};

const googleDriveMock = {
  uploadFile: jest.fn(),
  replaceFile: jest.fn(),
  downloadFile: jest.fn(),
  deleteFile: jest.fn(),
  listFiles: jest.fn(),
  getRootFolderId: jest.fn(),
  createFolder: jest.fn(),
  renameItem: jest.fn(),
  moveItem: jest.fn(),
  getConnectAuthUrl: jest.fn(),
  exchangeConnectCode: jest.fn(),
};

const dropboxMock = {
  uploadFile: jest.fn(),
  replaceFile: jest.fn(),
  downloadFile: jest.fn(),
  deleteFile: jest.fn(),
  listFiles: jest.fn(),
  createFolder: jest.fn(),
  renameItem: jest.fn(),
  moveItem: jest.fn(),
  getConnectAuthUrl: jest.fn(),
  exchangeConnectCode: jest.fn(),
};

const jwtMock = {
  sign: jest.fn(),
  verify: jest.fn(),
};

const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CloudStorageService', () => {
  let service: CloudStorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudStorageService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: GoogleDriveService, useValue: googleDriveMock },
        { provide: DropboxService, useValue: dropboxMock },
        { provide: JwtService, useValue: jwtMock },
        { provide: WINSTON_MODULE_PROVIDER, useValue: loggerMock },
      ],
    }).compile();

    service = module.get<CloudStorageService>(CloudStorageService);
    jest.clearAllMocks();
  });

  // ── uploadFile ───────────────────────────────────────────────────────────────

  describe('uploadFile()', () => {
    it('uploade sur Google Drive, crée le File en DB et retourne le fileId DB', async () => {
      googleDriveMock.uploadFile.mockResolvedValue('gdrive-id-1');
      prismaMock.file.create.mockResolvedValue(makeFile());

      const result = await service.uploadFile(
        'google-drive',
        'test.pdf',
        Buffer.from('data'),
        'application/pdf',
        'user-uuid-1',
        'enc-fek',
      );

      expect(googleDriveMock.uploadFile).toHaveBeenCalledWith(
        'test.pdf',
        expect.any(Buffer),
        'application/pdf',
        'user-uuid-1',
        null,
      );
      expect(prismaMock.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerId: 'user-uuid-1',
          cloud_data: expect.objectContaining({
            provider: 'google-drive',
            providerId: 'gdrive-id-1',
          }),
          permissions: expect.objectContaining({
            create: expect.objectContaining({
              userId: 'user-uuid-1',
              enc_fek: 'enc-fek',
              read: true,
              write: true,
              manage: true,
            }),
          }),
        }),
      });
      expect(result.fileId).toBe('file-uuid-1');
    });

    it('uploade sur Dropbox et crée le File en DB', async () => {
      dropboxMock.uploadFile.mockResolvedValue('/user-uuid-1/test.txt');
      prismaMock.file.create.mockResolvedValue(
        makeFile({
          cloud_data: {
            provider: 'dropbox',
            providerId: '/user-uuid-1/test.txt',
            name: 'test.txt',
          },
        }),
      );

      const result = await service.uploadFile(
        'dropbox',
        'test.txt',
        Buffer.from('data'),
        'text/plain',
        'user-uuid-1',
        'enc-fek',
      );

      expect(dropboxMock.uploadFile).toHaveBeenCalledWith(
        'test.txt',
        expect.any(Buffer),
        'text/plain',
        'user-uuid-1',
        null,
      );
      expect(result.fileId).toBe('file-uuid-1');
    });

    it('lève BadRequestException pour un provider inconnu', async () => {
      await expect(
        service.uploadFile(
          'unknown-provider' as any,
          'f',
          Buffer.from(''),
          '',
          'u',
          'k',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.file.create).not.toHaveBeenCalled();
    });

    it('remplace un fichier en conservant les partages existants', async () => {
      prismaMock.file.findMany.mockResolvedValue([
        makeFile({ folderId: null }),
      ]);
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1', folderId: null }),
      );
      googleDriveMock.replaceFile.mockResolvedValue('gdrive-id-1');
      prismaMock.file.update.mockResolvedValue(makeFile());
      prismaMock.filePermission.update.mockResolvedValue(
        makePermission({ userId: 'user-uuid-1' }),
      );

      const result = await service.uploadFile(
        'google-drive',
        'test.pdf',
        Buffer.from('new-data'),
        'application/pdf',
        'user-uuid-1',
        'same-owner-enc-fek',
        null,
        'sig-new',
        'file-uuid-1',
        'preserve',
      );

      expect(googleDriveMock.replaceFile).toHaveBeenCalledWith(
        'gdrive-id-1',
        expect.any(Buffer),
        'application/pdf',
        'user-uuid-1',
      );
      expect(prismaMock.filePermission.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.filePermission.upsert).toHaveBeenCalledWith({
        where: {
          fileId_userId: { fileId: 'file-uuid-1', userId: 'user-uuid-1' },
        },
        update: {
          enc_fek: 'same-owner-enc-fek',
          read: true,
          grantedById: 'user-uuid-1',
        },
        create: {
          fileId: 'file-uuid-1',
          userId: 'user-uuid-1',
          enc_fek: 'same-owner-enc-fek',
          read: true,
          write: true,
          manage: true,
          grantedById: 'user-uuid-1',
        },
      });
      expect(result.fileId).toBe('file-uuid-1');
    });

    it('remplace un fichier avec rotation de FEK et conserve seulement les destinataires fournis', async () => {
      prismaMock.file.findMany.mockResolvedValue([
        makeFile({ folderId: null }),
      ]);
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1', folderId: null }),
      );
      googleDriveMock.replaceFile.mockResolvedValue('gdrive-id-1');
      prismaMock.file.update.mockResolvedValue(makeFile());
      prismaMock.filePermission.update.mockResolvedValue(makePermission());
      prismaMock.filePermission.deleteMany.mockResolvedValue({ count: 1 });

      await service.uploadFile(
        'google-drive',
        'test.pdf',
        Buffer.from('new-data'),
        'application/pdf',
        'user-uuid-1',
        'new-owner-enc-fek',
        null,
        'sig-new',
        'file-uuid-1',
        'rotate',
        [{ userId: 'user-uuid-2', enc_fek: 'new-recipient-enc-fek' }],
      );

      expect(prismaMock.filePermission.deleteMany).toHaveBeenCalledWith({
        where: {
          fileId: 'file-uuid-1',
          userId: { notIn: ['user-uuid-1', 'user-uuid-2'] },
        },
      });
      expect(prismaMock.filePermission.update).toHaveBeenCalledWith({
        where: {
          fileId_userId: { fileId: 'file-uuid-1', userId: 'user-uuid-2' },
        },
        data: { enc_fek: 'new-recipient-enc-fek' },
      });
    });

    it('renomme le fichier provider et DB quand le remplacement utilise un nouveau nom', async () => {
      prismaMock.file.findMany.mockResolvedValue([]);
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1', folderId: null }),
      );
      googleDriveMock.replaceFile.mockResolvedValue('gdrive-id-1');
      prismaMock.file.update.mockResolvedValue(makeFile());
      prismaMock.filePermission.update.mockResolvedValue(
        makePermission({ userId: 'user-uuid-1' }),
      );

      await service.uploadFile(
        'google-drive',
        'nouveau.pdf',
        Buffer.from('new-data'),
        'application/pdf',
        'user-uuid-1',
        'same-owner-enc-fek',
        null,
        'sig-new',
        'file-uuid-1',
        'preserve',
      );

      expect(googleDriveMock.renameItem).toHaveBeenCalledWith(
        'gdrive-id-1',
        'nouveau.pdf',
        'user-uuid-1',
      );
      expect(prismaMock.file.update).toHaveBeenCalledWith({
        where: { id: 'file-uuid-1' },
        data: {
          cloud_data: expect.objectContaining({
            name: 'nouveau.pdf',
            providerId: 'gdrive-id-1',
            signature: 'sig-new',
            signedById: 'user-uuid-1',
          }),
        },
      });
    });
  });

  // ── listFiles ────────────────────────────────────────────────────────────────

  describe('listFiles()', () => {
    it("retourne les fichiers de l'utilisateur depuis la DB, correctement mappés", async () => {
      prismaMock.file.findMany.mockResolvedValue([
        makeFile(),
        makeFile({
          id: 'file-uuid-2',
          cloud_data: {
            provider: 'dropbox',
            providerId: '/user/doc.txt',
            name: 'doc.txt',
          },
        }),
      ]);

      const result = await service.listFiles('user-uuid-1');

      expect(prismaMock.file.findMany).toHaveBeenCalledWith({
        where: { ownerId: 'user-uuid-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'file-uuid-1',
        name: 'test.pdf',
        provider: 'google-drive',
      });
      expect(result[1]).toMatchObject({
        id: 'file-uuid-2',
        name: 'doc.txt',
        provider: 'dropbox',
      });
    });

    it("retourne un tableau vide si l'utilisateur n'a aucun fichier", async () => {
      prismaMock.file.findMany.mockResolvedValue([]);
      const result = await service.listFiles('user-uuid-1');
      expect(result).toEqual([]);
    });
  });

  // ── downloadFile ─────────────────────────────────────────────────────────────

  describe('downloadFile()', () => {
    const fileBuffer = Buffer.from('file content');

    it('télécharge le fichier pour le propriétaire sans vérifier les permissions', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      googleDriveMock.downloadFile.mockResolvedValue(fileBuffer);

      const result = await service.downloadFile('file-uuid-1', 'user-uuid-1');

      expect(prismaMock.filePermission.findUnique).not.toHaveBeenCalled();
      expect(googleDriveMock.downloadFile).toHaveBeenCalledWith(
        'gdrive-id-1',
        'user-uuid-1',
      );
      expect(result).toBe(fileBuffer);
    });

    it('télécharge le fichier pour un utilisateur avec permission de lecture', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      prismaMock.filePermission.findUnique.mockResolvedValue(
        makePermission({ read: true }),
      );
      googleDriveMock.downloadFile.mockResolvedValue(fileBuffer);

      const result = await service.downloadFile('file-uuid-1', 'user-uuid-2');

      expect(prismaMock.filePermission.findUnique).toHaveBeenCalledWith({
        where: {
          fileId_userId: { fileId: 'file-uuid-1', userId: 'user-uuid-2' },
        },
      });
      expect(googleDriveMock.downloadFile).toHaveBeenCalledWith(
        'gdrive-id-1',
        'user-uuid-1',
      );
      expect(result).toBe(fileBuffer);
    });

    it('lève NotFoundException si le fichier est introuvable', async () => {
      prismaMock.file.findUnique.mockResolvedValue(null);

      await expect(
        service.downloadFile('bad-uuid', 'user-uuid-1'),
      ).rejects.toThrow(NotFoundException);
      expect(googleDriveMock.downloadFile).not.toHaveBeenCalled();
    });

    it("lève ForbiddenException si l'utilisateur n'a pas de permission", async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      prismaMock.filePermission.findUnique.mockResolvedValue(null);

      await expect(
        service.downloadFile('file-uuid-1', 'user-uuid-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lève ForbiddenException si la permission de lecture est false', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      prismaMock.filePermission.findUnique.mockResolvedValue(
        makePermission({ read: false }),
      );

      await expect(
        service.downloadFile('file-uuid-1', 'user-uuid-2'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── deleteFile ───────────────────────────────────────────────────────────────

  describe('deleteFile()', () => {
    it('supprime le fichier du provider et de la DB pour le propriétaire', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      googleDriveMock.deleteFile.mockResolvedValue(undefined);
      prismaMock.file.delete.mockResolvedValue(makeFile());

      await service.deleteFile('file-uuid-1', 'user-uuid-1');

      expect(googleDriveMock.deleteFile).toHaveBeenCalledWith(
        'gdrive-id-1',
        'user-uuid-1',
      );
      expect(prismaMock.file.delete).toHaveBeenCalledWith({
        where: { id: 'file-uuid-1' },
      });
    });

    it('refuse la suppression pour un utilisateur partagé même avec permission de gestion', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      prismaMock.filePermission.findUnique.mockResolvedValue(
        makePermission({ manage: true }),
      );

      await expect(
        service.deleteFile('file-uuid-1', 'user-uuid-2'),
      ).rejects.toThrow(ForbiddenException);

      expect(googleDriveMock.deleteFile).not.toHaveBeenCalled();
      expect(prismaMock.file.delete).not.toHaveBeenCalled();
    });

    it('lève NotFoundException si le fichier est introuvable', async () => {
      prismaMock.file.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteFile('bad-uuid', 'user-uuid-1'),
      ).rejects.toThrow(NotFoundException);
      expect(googleDriveMock.deleteFile).not.toHaveBeenCalled();
      expect(prismaMock.file.delete).not.toHaveBeenCalled();
    });

    it('lève ForbiddenException si la permission de gestion est absente', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      prismaMock.filePermission.findUnique.mockResolvedValue(
        makePermission({ manage: false }),
      );

      await expect(
        service.deleteFile('file-uuid-1', 'user-uuid-2'),
      ).rejects.toThrow(ForbiddenException);
      expect(googleDriveMock.deleteFile).not.toHaveBeenCalled();
    });

    it('utilise le bon provider (Dropbox) selon cloud_data', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({
          cloud_data: {
            provider: 'dropbox',
            providerId: '/uid/file.txt',
            name: 'file.txt',
          },
        }),
      );
      dropboxMock.deleteFile.mockResolvedValue(undefined);
      prismaMock.file.delete.mockResolvedValue({});

      await service.deleteFile('file-uuid-1', 'user-uuid-1');

      expect(dropboxMock.deleteFile).toHaveBeenCalledWith(
        '/uid/file.txt',
        'user-uuid-1',
      );
      expect(googleDriveMock.deleteFile).not.toHaveBeenCalled();
    });
  });

  // ── uploadFile : validation du dossier de destination ─────────────────────────

  describe('uploadFile() — dossier de destination', () => {
    it('valide le dossier puis enregistre le File avec folderId', async () => {
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'fol-1',
        ownerId: 'user-uuid-1',
        providerId: 'drive-folder-1',
      });
      googleDriveMock.uploadFile.mockResolvedValue('gdrive-id-1');
      prismaMock.file.create.mockResolvedValue(makeFile());

      await service.uploadFile(
        'google-drive',
        'd.pdf',
        Buffer.from('x'),
        'application/octet-stream',
        'user-uuid-1',
        'enc',
        'fol-1',
      );

      expect(googleDriveMock.uploadFile).toHaveBeenCalledWith(
        'd.pdf',
        expect.any(Buffer),
        'application/octet-stream',
        'user-uuid-1',
        'drive-folder-1',
      );
      expect(prismaMock.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerId: 'user-uuid-1',
          folderId: 'fol-1',
        }),
      });
    });

    it("refuse un dossier appartenant à quelqu'un d'autre (Forbidden)", async () => {
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'fol-1',
        ownerId: 'someone-else',
      });
      await expect(
        service.uploadFile(
          'google-drive',
          'd',
          Buffer.from(''),
          '',
          'user-uuid-1',
          'enc',
          'fol-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(googleDriveMock.uploadFile).not.toHaveBeenCalled();
    });

    it('refuse un dossier inexistant (NotFound)', async () => {
      prismaMock.folder.findUnique.mockResolvedValue(null);
      await expect(
        service.uploadFile(
          'google-drive',
          'd',
          Buffer.from(''),
          '',
          'user-uuid-1',
          'enc',
          'bad',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── browse ─────────────────────────────────────────────────────────────────────

  describe('browse()', () => {
    it('liste sous-dossiers + fichiers (avec enc_fek) à la racine', async () => {
      prismaMock.folder.findMany.mockResolvedValue([
        { id: 'fol-1', name: 'Docs', parentId: null, createdAt: new Date() },
      ]);
      prismaMock.file.findMany.mockResolvedValue([
        makeFile({
          folderId: null,
          cloud_data: {
            provider: 'google-drive',
            providerId: 'gdrive-id-1',
            name: 'test.pdf',
            mimeType: 'application/pdf',
            signedById: 'user-uuid-2',
            signature: 'sig',
          },
          permissions: [{ enc_fek: 'k1' }],
        }),
      ]);
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'user-uuid-2', username: 'bob', sign_pub_key: 'bob-sign-pub' },
      ]);

      const res = await service.browse('user-uuid-1', null);

      expect(res.folder).toBeNull();
      expect(res.breadcrumb).toEqual([]);
      expect(res.folders).toHaveLength(1);
      expect(res.files[0]).toMatchObject({
        id: 'file-uuid-1',
        name: 'test.pdf',
        enc_fek: 'k1',
        folderId: null,
        signedBy: { id: 'user-uuid-2', sign_pub_key: 'bob-sign-pub' },
      });
    });

    it("construit le fil d'Ariane dans un sous-dossier", async () => {
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'fol-1',
        name: 'Docs',
        parentId: null,
        ownerId: 'user-uuid-1',
      });
      prismaMock.folder.findMany.mockResolvedValue([]);
      prismaMock.file.findMany.mockResolvedValue([]);

      const res = await service.browse('user-uuid-1', 'fol-1');

      expect(res.folder).toMatchObject({ id: 'fol-1', name: 'Docs' });
      expect(res.breadcrumb).toEqual([{ id: 'fol-1', name: 'Docs' }]);
    });

    it('refuse un dossier non possédé (Forbidden)', async () => {
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'fol-1',
        ownerId: 'other',
      });
      await expect(service.browse('user-uuid-1', 'fol-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── createFolder ───────────────────────────────────────────────────────────────

  describe('createFolder()', () => {
    it('crée un dossier (nom trimmé) à la racine', async () => {
      googleDriveMock.createFolder.mockResolvedValue('drive-folder-1');
      prismaMock.folder.create.mockResolvedValue({
        id: 'fol-1',
        name: 'Docs',
        parentId: null,
        createdAt: new Date(),
      });
      const res = await service.createFolder('user-uuid-1', '  Docs  ', null);
      expect(res).toMatchObject({ id: 'fol-1', name: 'Docs' });
      expect(googleDriveMock.createFolder).toHaveBeenCalledWith(
        'Docs',
        null,
        'user-uuid-1',
      );
      expect(prismaMock.folder.create).toHaveBeenCalledWith({
        data: {
          ownerId: 'user-uuid-1',
          name: 'Docs',
          parentId: null,
          providerId: 'drive-folder-1',
          provider: 'google-drive',
        },
      });
    });

    it('lève BadRequest si le nom est vide', async () => {
      await expect(
        service.createFolder('user-uuid-1', '   ', null),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.folder.create).not.toHaveBeenCalled();
    });

    it('valide le dossier parent', async () => {
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'p',
        ownerId: 'other',
      });
      await expect(
        service.createFolder('user-uuid-1', 'X', 'p'),
      ).rejects.toThrow(ForbiddenException);
      expect(googleDriveMock.createFolder).not.toHaveBeenCalled();
    });

    it('crée le dossier Drive sous le providerId du parent', async () => {
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'p',
        ownerId: 'user-uuid-1',
        providerId: 'drive-parent',
      });
      googleDriveMock.createFolder.mockResolvedValue('drive-child');
      prismaMock.folder.create.mockResolvedValue({
        id: 'fol-1',
        name: 'Child',
        parentId: 'p',
        createdAt: new Date(),
      });

      await service.createFolder('user-uuid-1', 'Child', 'p');

      expect(googleDriveMock.createFolder).toHaveBeenCalledWith(
        'Child',
        'drive-parent',
        'user-uuid-1',
      );
    });
  });

  // ── updateFolder (renommer / déplacer) ─────────────────────────────────────────

  describe('updateFolder()', () => {
    it('renomme (nom trimmé)', async () => {
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'fol-1',
        ownerId: 'user-uuid-1',
        parentId: null,
        providerId: 'drive-folder-1',
      });
      prismaMock.folder.update.mockResolvedValue({
        id: 'fol-1',
        name: 'New',
        parentId: null,
        createdAt: new Date(),
      });

      await service.updateFolder('user-uuid-1', 'fol-1', { name: '  New  ' });

      expect(googleDriveMock.renameItem).toHaveBeenCalledWith(
        'drive-folder-1',
        'New',
        'user-uuid-1',
      );
      expect(prismaMock.folder.update).toHaveBeenCalledWith({
        where: { id: 'fol-1' },
        data: { name: 'New' },
      });
    });

    it('déplace vers un autre dossier', async () => {
      const tree: Record<string, any> = {
        'fol-1': {
          id: 'fol-1',
          ownerId: 'user-uuid-1',
          parentId: null,
          providerId: 'drive-folder-1',
        },
        'fol-2': {
          id: 'fol-2',
          ownerId: 'user-uuid-1',
          parentId: null,
          providerId: 'drive-folder-2',
        },
      };
      prismaMock.folder.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(tree[where.id] ?? null),
      );
      prismaMock.folder.update.mockResolvedValue({
        id: 'fol-1',
        name: 'A',
        parentId: 'fol-2',
        createdAt: new Date(),
      });

      await service.updateFolder('user-uuid-1', 'fol-1', { parentId: 'fol-2' });

      expect(googleDriveMock.moveItem).toHaveBeenCalledWith(
        'drive-folder-1',
        'drive-folder-2',
        'user-uuid-1',
      );
      expect(prismaMock.folder.update).toHaveBeenCalledWith({
        where: { id: 'fol-1' },
        data: { parentId: 'fol-2' },
      });
    });

    it('empêche un dossier de devenir son propre parent', async () => {
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'fol-1',
        ownerId: 'user-uuid-1',
        parentId: null,
      });
      await expect(
        service.updateFolder('user-uuid-1', 'fol-1', { parentId: 'fol-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('empêche un cycle (déplacement dans un descendant)', async () => {
      const tree: Record<string, any> = {
        'fol-1': { id: 'fol-1', ownerId: 'user-uuid-1', parentId: null },
        'fol-2': { id: 'fol-2', ownerId: 'user-uuid-1', parentId: 'fol-1' }, // fol-2 enfant de fol-1
      };
      prismaMock.folder.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(tree[where.id] ?? null),
      );

      await expect(
        service.updateFolder('user-uuid-1', 'fol-1', { parentId: 'fol-2' }),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.folder.update).not.toHaveBeenCalled();
    });
  });

  // ── deleteFolder (récursif) ────────────────────────────────────────────────────

  describe('deleteFolder()', () => {
    it('supprime le sous-arbre : fichiers (provider + DB) puis dossiers', async () => {
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'fol-1',
        ownerId: 'user-uuid-1',
        providerId: 'drive-folder-1',
      });
      // BFS : fol-1 a un enfant fol-2, fol-2 n'a pas d'enfant.
      prismaMock.folder.findMany
        .mockResolvedValueOnce([{ id: 'fol-2' }])
        .mockResolvedValueOnce([]);
      prismaMock.file.findMany.mockResolvedValue([makeFile()]);
      googleDriveMock.deleteFile.mockResolvedValue(undefined);
      prismaMock.folder.delete.mockResolvedValue({});

      await service.deleteFolder('user-uuid-1', 'fol-1');

      expect(googleDriveMock.deleteFile).toHaveBeenCalledWith(
        'gdrive-id-1',
        'user-uuid-1',
      );
      expect(googleDriveMock.deleteFile).toHaveBeenCalledWith(
        'drive-folder-1',
        'user-uuid-1',
      );
      expect(prismaMock.file.findMany).toHaveBeenCalledWith({
        where: { folderId: { in: ['fol-1', 'fol-2'] } },
      });
      expect(prismaMock.folder.delete).toHaveBeenCalledWith({
        where: { id: 'fol-1' },
      });
    });

    it('refuse un dossier non possédé (Forbidden)', async () => {
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'fol-1',
        ownerId: 'other',
      });
      await expect(
        service.deleteFolder('user-uuid-1', 'fol-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.folder.delete).not.toHaveBeenCalled();
    });
  });

  // ── updateFile (renommer / déplacer) ───────────────────────────────────────────

  describe('updateFile()', () => {
    it('renomme via cloud_data (nom trimmé)', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      prismaMock.file.findMany.mockResolvedValue([]);
      prismaMock.file.update.mockResolvedValue({});

      await service.updateFile('user-uuid-1', 'file-uuid-1', {
        name: '  new.pdf  ',
      });

      expect(googleDriveMock.renameItem).toHaveBeenCalledWith(
        'gdrive-id-1',
        'new.pdf',
        'user-uuid-1',
      );
      expect(prismaMock.file.update).toHaveBeenCalledWith({
        where: { id: 'file-uuid-1' },
        data: {
          cloud_data: expect.objectContaining({
            name: 'new.pdf',
            provider: 'google-drive',
          }),
        },
      });
    });

    it('refuse de renommer avec le nom d’un autre fichier du même dossier', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1', folderId: 'fol-1' }),
      );
      prismaMock.file.findMany.mockResolvedValue([
        makeFile({
          id: 'file-uuid-2',
          ownerId: 'user-uuid-1',
          folderId: 'fol-1',
          cloud_data: {
            provider: 'google-drive',
            providerId: 'gdrive-id-2',
            name: 'existing.pdf',
            mimeType: 'application/pdf',
          },
        }),
      ]);

      await expect(
        service.updateFile('user-uuid-1', 'file-uuid-1', {
          name: 'existing.pdf',
        }),
      ).rejects.toThrow(ConflictException);
      expect(googleDriveMock.renameItem).not.toHaveBeenCalled();
      expect(prismaMock.file.update).not.toHaveBeenCalled();
    });

    it('déplace vers un dossier possédé', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'fol-2',
        ownerId: 'user-uuid-1',
        providerId: 'drive-folder-2',
      });
      prismaMock.file.update.mockResolvedValue({});

      await service.updateFile('user-uuid-1', 'file-uuid-1', {
        folderId: 'fol-2',
      });

      expect(googleDriveMock.moveItem).toHaveBeenCalledWith(
        'gdrive-id-1',
        'drive-folder-2',
        'user-uuid-1',
      );
      expect(prismaMock.file.update).toHaveBeenCalledWith({
        where: { id: 'file-uuid-1' },
        data: { folderId: 'fol-2' },
      });
    });

    it('refuse un déplacement vers un dossier non possédé (Forbidden)', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      prismaMock.folder.findUnique.mockResolvedValue({
        id: 'fol-2',
        ownerId: 'other',
      });

      await expect(
        service.updateFile('user-uuid-1', 'file-uuid-1', { folderId: 'fol-2' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.file.update).not.toHaveBeenCalled();
    });
  });

  // ── sharing ────────────────────────────────────────────────────────────────

  describe('shareFile()', () => {
    it('crée une permission avec enc_fek chiffrée pour le destinataire', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-uuid-2',
        username: 'bob',
        email: 'bob@example.test',
      });
      prismaMock.filePermission.upsert.mockResolvedValue(
        makePermission({
          userId: 'user-uuid-2',
          read: true,
          write: true,
          manage: true,
          grantedAt: new Date('2026-01-02T00:00:00Z'),
        }),
      );

      const result = await service.shareFile(
        'user-uuid-1',
        'file-uuid-1',
        'user-uuid-2',
        'enc-for-bob',
        true,
        true,
        true,
      );

      expect(prismaMock.filePermission.upsert).toHaveBeenCalledWith({
        where: {
          fileId_userId: { fileId: 'file-uuid-1', userId: 'user-uuid-2' },
        },
        update: {
          enc_fek: 'enc-for-bob',
          read: true,
          write: true,
          manage: true,
          grantedById: 'user-uuid-1',
        },
        create: {
          fileId: 'file-uuid-1',
          userId: 'user-uuid-2',
          enc_fek: 'enc-for-bob',
          read: true,
          write: true,
          manage: true,
          grantedById: 'user-uuid-1',
        },
      });
      expect(result).toMatchObject({
        userId: 'user-uuid-2',
        username: 'bob',
        read: true,
        write: true,
        manage: true,
      });
    });

    it('autorise le partage par un utilisateur qui a le droit de gérer', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'owner' }),
      );
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-uuid-3',
        username: 'carol',
        email: 'carol@example.test',
      });
      prismaMock.filePermission.findUnique.mockResolvedValue(
        makePermission({ userId: 'manager', manage: true }),
      );
      prismaMock.filePermission.upsert.mockResolvedValue(
        makePermission({
          userId: 'user-uuid-3',
          read: true,
          write: false,
          manage: false,
        }),
      );

      await expect(
        service.shareFile('manager', 'file-uuid-1', 'user-uuid-3', 'enc'),
      ).resolves.toMatchObject({
        userId: 'user-uuid-3',
        read: true,
      });
      expect(prismaMock.filePermission.upsert).toHaveBeenCalled();
    });

    it('refuse le partage par un utilisateur sans droit de gestion', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'owner' }),
      );
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-uuid-2',
        username: 'bob',
        email: 'bob@example.test',
      });
      prismaMock.filePermission.findUnique.mockResolvedValue(null);

      await expect(
        service.shareFile('intruder', 'file-uuid-1', 'user-uuid-2', 'enc'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.filePermission.upsert).not.toHaveBeenCalled();
    });
  });

  describe('updateFileShare()', () => {
    it('modifie les droits si l acteur peut gérer les partages', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'user-uuid-1' }),
      );
      prismaMock.filePermission.findUnique.mockResolvedValue(
        makePermission({
          userId: 'user-uuid-2',
          read: true,
          write: false,
          manage: false,
        }),
      );
      prismaMock.filePermission.update.mockResolvedValue({
        ...makePermission({
          userId: 'user-uuid-2',
          read: true,
          write: true,
          manage: true,
        }),
        user: {
          id: 'user-uuid-2',
          username: 'bob',
          email: 'bob@example.test',
          pub_key: 'pub',
        },
      });

      const result = await service.updateFileShare(
        'user-uuid-1',
        'file-uuid-1',
        'user-uuid-2',
        { write: true, manage: true },
      );

      expect(prismaMock.filePermission.update).toHaveBeenCalledWith({
        where: {
          fileId_userId: { fileId: 'file-uuid-1', userId: 'user-uuid-2' },
        },
        data: {
          read: true,
          write: true,
          manage: true,
          grantedById: 'user-uuid-1',
        },
        include: {
          user: {
            select: { id: true, username: true, email: true, pub_key: true },
          },
        },
      });
      expect(result).toMatchObject({
        userId: 'user-uuid-2',
        write: true,
        manage: true,
      });
    });

    it('refuse qu un gestionnaire modifie ses propres droits', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'owner' }),
      );
      prismaMock.filePermission.findUnique.mockResolvedValue(
        makePermission({
          userId: 'manager',
          read: true,
          write: true,
          manage: true,
        }),
      );

      await expect(
        service.updateFileShare('manager', 'file-uuid-1', 'manager', {
          manage: false,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.filePermission.update).not.toHaveBeenCalled();
    });
  });

  describe('revokeFileShare()', () => {
    it('refuse qu un gestionnaire supprime son propre partage', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'owner' }),
      );
      prismaMock.filePermission.findUnique.mockResolvedValue(
        makePermission({
          userId: 'manager',
          read: true,
          write: true,
          manage: true,
        }),
      );

      await expect(
        service.revokeFileShare('manager', 'file-uuid-1', 'manager'),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.filePermission.delete).not.toHaveBeenCalled();
    });
  });

  describe('listSharedWithMe()', () => {
    it('retourne les fichiers partagés avec enc_fek du destinataire et propriétaire', async () => {
      prismaMock.filePermission.findMany.mockResolvedValue([
        {
          ...makePermission({
            userId: 'user-uuid-2',
            enc_fek: 'enc-for-me',
            grantedAt: new Date('2026-01-02T00:00:00Z'),
          }),
          file: {
            ...makeFile({
              ownerId: 'user-uuid-1',
              folderId: 'fol-1',
              cloud_data: {
                provider: 'google-drive',
                providerId: 'gdrive-id-1',
                name: 'test.pdf',
                mimeType: 'application/pdf',
                signedById: 'user-uuid-2',
                signature: 'sig-by-bob',
              },
            }),
            owner: {
              id: 'user-uuid-1',
              username: 'alice',
              email: 'alice@example.test',
              sign_pub_key: 'sign-pub',
            },
          },
        },
      ]);
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'user-uuid-2', username: 'bob', sign_pub_key: 'bob-sign-pub' },
      ]);

      const result = await service.listSharedWithMe('user-uuid-2');

      expect(prismaMock.filePermission.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid-2',
          read: true,
          file: { ownerId: { not: 'user-uuid-2' } },
        },
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
      expect(result[0]).toMatchObject({
        id: 'file-uuid-1',
        name: 'test.pdf',
        enc_fek: 'enc-for-me',
        owner: { username: 'alice' },
        signedBy: {
          id: 'user-uuid-2',
          username: 'bob',
          sign_pub_key: 'bob-sign-pub',
        },
      });
    });
  });

  // ── listProviderFiles ────────────────────────────────────────────────────────

  describe('listProviderFiles()', () => {
    it('délègue au service Google Drive', async () => {
      googleDriveMock.listFiles.mockResolvedValue([
        { id: 'gdrive-1', name: 'doc.pdf' },
      ]);

      const result = await service.listProviderFiles(
        'google-drive',
        'user-uuid-1',
      );

      expect(googleDriveMock.listFiles).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toHaveLength(1);
    });

    it('délègue au service Dropbox', async () => {
      dropboxMock.listFiles.mockResolvedValue([
        { id: '/uid/doc.txt', name: 'doc.txt' },
      ]);

      const result = await service.listProviderFiles('dropbox', 'user-uuid-1');

      expect(dropboxMock.listFiles).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toHaveLength(1);
    });
  });
});
