import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
    delete: jest.fn(),
  },
  filePermission: {
    findUnique: jest.fn(),
  },
  oidcConnection: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
};

const googleDriveMock = {
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
  deleteFile: jest.fn(),
  listFiles: jest.fn(),
  getConnectAuthUrl: jest.fn(),
  exchangeConnectCode: jest.fn(),
};

const dropboxMock = {
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
  deleteFile: jest.fn(),
  listFiles: jest.fn(),
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
        'google-drive', 'test.pdf', Buffer.from('data'), 'application/pdf', 'user-uuid-1', 'enc-fek',
      );

      expect(googleDriveMock.uploadFile).toHaveBeenCalledWith('test.pdf', expect.any(Buffer), 'application/pdf', 'user-uuid-1');
      expect(prismaMock.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerId: 'user-uuid-1',
          cloud_data: expect.objectContaining({ provider: 'google-drive', providerId: 'gdrive-id-1' }),
          permissions: expect.objectContaining({
            create: expect.objectContaining({ userId: 'user-uuid-1', enc_fek: 'enc-fek', read: true, write: true }),
          }),
        }),
      });
      expect(result.fileId).toBe('file-uuid-1');
    });

    it('uploade sur Dropbox et crée le File en DB', async () => {
      dropboxMock.uploadFile.mockResolvedValue('/user-uuid-1/test.txt');
      prismaMock.file.create.mockResolvedValue(
        makeFile({ cloud_data: { provider: 'dropbox', providerId: '/user-uuid-1/test.txt', name: 'test.txt' } }),
      );

      const result = await service.uploadFile(
        'dropbox', 'test.txt', Buffer.from('data'), 'text/plain', 'user-uuid-1', 'enc-fek',
      );

      expect(dropboxMock.uploadFile).toHaveBeenCalledWith('test.txt', expect.any(Buffer), 'text/plain', 'user-uuid-1');
      expect(result.fileId).toBe('file-uuid-1');
    });

    it('lève BadRequestException pour un provider inconnu', async () => {
      await expect(
        service.uploadFile('unknown-provider' as any, 'f', Buffer.from(''), '', 'u', 'k'),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.file.create).not.toHaveBeenCalled();
    });
  });

  // ── listFiles ────────────────────────────────────────────────────────────────

  describe('listFiles()', () => {
    it('retourne les fichiers de l\'utilisateur depuis la DB, correctement mappés', async () => {
      prismaMock.file.findMany.mockResolvedValue([
        makeFile(),
        makeFile({
          id: 'file-uuid-2',
          cloud_data: { provider: 'dropbox', providerId: '/user/doc.txt', name: 'doc.txt' },
        }),
      ]);

      const result = await service.listFiles('user-uuid-1');

      expect(prismaMock.file.findMany).toHaveBeenCalledWith({
        where: { ownerId: 'user-uuid-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'file-uuid-1', name: 'test.pdf', provider: 'google-drive' });
      expect(result[1]).toMatchObject({ id: 'file-uuid-2', name: 'doc.txt', provider: 'dropbox' });
    });

    it('retourne un tableau vide si l\'utilisateur n\'a aucun fichier', async () => {
      prismaMock.file.findMany.mockResolvedValue([]);
      const result = await service.listFiles('user-uuid-1');
      expect(result).toEqual([]);
    });
  });

  // ── downloadFile ─────────────────────────────────────────────────────────────

  describe('downloadFile()', () => {
    const fileBuffer = Buffer.from('file content');

    it('télécharge le fichier pour le propriétaire sans vérifier les permissions', async () => {
      prismaMock.file.findUnique.mockResolvedValue(makeFile({ ownerId: 'user-uuid-1' }));
      googleDriveMock.downloadFile.mockResolvedValue(fileBuffer);

      const result = await service.downloadFile('file-uuid-1', 'user-uuid-1');

      expect(prismaMock.filePermission.findUnique).not.toHaveBeenCalled();
      expect(googleDriveMock.downloadFile).toHaveBeenCalledWith('gdrive-id-1', 'user-uuid-1');
      expect(result).toBe(fileBuffer);
    });

    it('télécharge le fichier pour un utilisateur avec permission de lecture', async () => {
      prismaMock.file.findUnique.mockResolvedValue(makeFile({ ownerId: 'user-uuid-1' }));
      prismaMock.filePermission.findUnique.mockResolvedValue(makePermission({ read: true }));
      googleDriveMock.downloadFile.mockResolvedValue(fileBuffer);

      const result = await service.downloadFile('file-uuid-1', 'user-uuid-2');

      expect(prismaMock.filePermission.findUnique).toHaveBeenCalledWith({
        where: { fileId_userId: { fileId: 'file-uuid-1', userId: 'user-uuid-2' } },
      });
      expect(result).toBe(fileBuffer);
    });

    it('lève NotFoundException si le fichier est introuvable', async () => {
      prismaMock.file.findUnique.mockResolvedValue(null);

      await expect(service.downloadFile('bad-uuid', 'user-uuid-1')).rejects.toThrow(NotFoundException);
      expect(googleDriveMock.downloadFile).not.toHaveBeenCalled();
    });

    it('lève ForbiddenException si l\'utilisateur n\'a pas de permission', async () => {
      prismaMock.file.findUnique.mockResolvedValue(makeFile({ ownerId: 'user-uuid-1' }));
      prismaMock.filePermission.findUnique.mockResolvedValue(null);

      await expect(service.downloadFile('file-uuid-1', 'user-uuid-2')).rejects.toThrow(ForbiddenException);
    });

    it('lève ForbiddenException si la permission de lecture est false', async () => {
      prismaMock.file.findUnique.mockResolvedValue(makeFile({ ownerId: 'user-uuid-1' }));
      prismaMock.filePermission.findUnique.mockResolvedValue(makePermission({ read: false }));

      await expect(service.downloadFile('file-uuid-1', 'user-uuid-2')).rejects.toThrow(ForbiddenException);
    });
  });

  // ── deleteFile ───────────────────────────────────────────────────────────────

  describe('deleteFile()', () => {
    it('supprime le fichier du provider et de la DB pour le propriétaire', async () => {
      prismaMock.file.findUnique.mockResolvedValue(makeFile({ ownerId: 'user-uuid-1' }));
      googleDriveMock.deleteFile.mockResolvedValue(undefined);
      prismaMock.file.delete.mockResolvedValue(makeFile());

      await service.deleteFile('file-uuid-1', 'user-uuid-1');

      expect(googleDriveMock.deleteFile).toHaveBeenCalledWith('gdrive-id-1', 'user-uuid-1');
      expect(prismaMock.file.delete).toHaveBeenCalledWith({ where: { id: 'file-uuid-1' } });
    });

    it('supprime le fichier pour un utilisateur avec permission d\'écriture', async () => {
      prismaMock.file.findUnique.mockResolvedValue(makeFile({ ownerId: 'user-uuid-1' }));
      prismaMock.filePermission.findUnique.mockResolvedValue(makePermission({ write: true }));
      googleDriveMock.deleteFile.mockResolvedValue(undefined);
      prismaMock.file.delete.mockResolvedValue(makeFile());

      await service.deleteFile('file-uuid-1', 'user-uuid-2');

      expect(googleDriveMock.deleteFile).toHaveBeenCalled();
      expect(prismaMock.file.delete).toHaveBeenCalled();
    });

    it('lève NotFoundException si le fichier est introuvable', async () => {
      prismaMock.file.findUnique.mockResolvedValue(null);

      await expect(service.deleteFile('bad-uuid', 'user-uuid-1')).rejects.toThrow(NotFoundException);
      expect(googleDriveMock.deleteFile).not.toHaveBeenCalled();
      expect(prismaMock.file.delete).not.toHaveBeenCalled();
    });

    it('lève ForbiddenException si la permission d\'écriture est absente', async () => {
      prismaMock.file.findUnique.mockResolvedValue(makeFile({ ownerId: 'user-uuid-1' }));
      prismaMock.filePermission.findUnique.mockResolvedValue(makePermission({ write: false }));

      await expect(service.deleteFile('file-uuid-1', 'user-uuid-2')).rejects.toThrow(ForbiddenException);
      expect(googleDriveMock.deleteFile).not.toHaveBeenCalled();
    });

    it('utilise le bon provider (Dropbox) selon cloud_data', async () => {
      prismaMock.file.findUnique.mockResolvedValue(
        makeFile({ cloud_data: { provider: 'dropbox', providerId: '/uid/file.txt', name: 'file.txt' } }),
      );
      dropboxMock.deleteFile.mockResolvedValue(undefined);
      prismaMock.file.delete.mockResolvedValue({});

      await service.deleteFile('file-uuid-1', 'user-uuid-1');

      expect(dropboxMock.deleteFile).toHaveBeenCalledWith('/uid/file.txt', 'user-uuid-1');
      expect(googleDriveMock.deleteFile).not.toHaveBeenCalled();
    });
  });

  // ── listProviderFiles ────────────────────────────────────────────────────────

  describe('listProviderFiles()', () => {
    it('délègue au service Google Drive', async () => {
      googleDriveMock.listFiles.mockResolvedValue([{ id: 'gdrive-1', name: 'doc.pdf' }]);

      const result = await service.listProviderFiles('google-drive', 'user-uuid-1');

      expect(googleDriveMock.listFiles).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toHaveLength(1);
    });

    it('délègue au service Dropbox', async () => {
      dropboxMock.listFiles.mockResolvedValue([{ id: '/uid/doc.txt', name: 'doc.txt' }]);

      const result = await service.listProviderFiles('dropbox', 'user-uuid-1');

      expect(dropboxMock.listFiles).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toHaveLength(1);
    });
  });
});
