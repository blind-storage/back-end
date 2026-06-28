import { Test, TestingModule } from '@nestjs/testing';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { CloudStorageController } from './cloud-storage.controller';
import { CloudStorageService } from './cloud-storage.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const serviceMock = {
  listFiles: jest.fn(),
  browse: jest.fn(),
  listSharedWithMe: jest.fn(),
  createFolder: jest.fn(),
  updateFolder: jest.fn(),
  deleteFolder: jest.fn(),
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
  updateFile: jest.fn(),
  listFileShares: jest.fn(),
  shareFile: jest.fn(),
  revokeFileShare: jest.fn(),
  deleteFile: jest.fn(),
  getProvidersStatus: jest.fn(),
  getConnectUrl: jest.fn(),
};

const loggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const guardAllow = { canActivate: () => true };
const req = { user: { id: 'user-1' } };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CloudStorageController', () => {
  let controller: CloudStorageController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudStorageController],
      providers: [
        { provide: CloudStorageService, useValue: serviceMock },
        { provide: WINSTON_MODULE_PROVIDER, useValue: loggerMock },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardAllow)
      .compile();

    controller = module.get<CloudStorageController>(CloudStorageController);
    jest.clearAllMocks();
  });

  // ── GET /cloud-storage/files ─────────────────────────────────────────────────

  describe('listFiles()', () => {
    it("retourne les fichiers de l'utilisateur", async () => {
      serviceMock.listFiles.mockResolvedValue([{ id: 'f1' }]);
      const result = await controller.listFiles(req);
      expect(result).toEqual({ files: [{ id: 'f1' }] });
      expect(serviceMock.listFiles).toHaveBeenCalledWith('user-1');
    });
  });

  // ── GET /cloud-storage/browse ────────────────────────────────────────────────

  describe('browse()', () => {
    it('délègue au service avec le folderId', async () => {
      const res = { folder: null, breadcrumb: [], folders: [], files: [] };
      serviceMock.browse.mockResolvedValue(res);
      const result = await controller.browse(req, 'folder-1');
      expect(result).toBe(res);
      expect(serviceMock.browse).toHaveBeenCalledWith('user-1', 'folder-1', 'google-drive');
    });

    it('passe null pour la racine quand folderId est absent', async () => {
      serviceMock.browse.mockResolvedValue({});
      await controller.browse(req, undefined);
      expect(serviceMock.browse).toHaveBeenCalledWith('user-1', null, 'google-drive');
    });
  });

  // ── GET /cloud-storage/shared-with-me ───────────────────────────────────────

  describe('sharedWithMe()', () => {
    it('retourne les fichiers partagés avec l’utilisateur', async () => {
      serviceMock.listSharedWithMe.mockResolvedValue([{ id: 'f1', owner: { username: 'alice' } }]);
      const result = await controller.sharedWithMe(req);
      expect(result).toEqual({ files: [{ id: 'f1', owner: { username: 'alice' } }] });
      expect(serviceMock.listSharedWithMe).toHaveBeenCalledWith('user-1');
    });
  });

  // ── POST /cloud-storage/folders ──────────────────────────────────────────────

  describe('createFolder()', () => {
    it('crée un dossier dans le parent fourni', async () => {
      serviceMock.createFolder.mockResolvedValue({ id: 'fol-1', name: 'Docs' });
      const result = await controller.createFolder(req, { name: 'Docs', parentId: 'p1' });
      expect(result).toEqual({ id: 'fol-1', name: 'Docs' });
      expect(serviceMock.createFolder).toHaveBeenCalledWith('user-1', 'Docs', 'p1', 'google-drive');
    });

    it('crée à la racine quand parentId est absent', async () => {
      serviceMock.createFolder.mockResolvedValue({ id: 'fol-1' });
      await controller.createFolder(req, { name: 'Docs' });
      expect(serviceMock.createFolder).toHaveBeenCalledWith('user-1', 'Docs', null, 'google-drive');
    });
  });

  // ── PATCH /cloud-storage/folders/:id ─────────────────────────────────────────

  describe('updateFolder()', () => {
    it('renomme/déplace via le service', async () => {
      serviceMock.updateFolder.mockResolvedValue({ id: 'fol-1', name: 'New' });
      const result = await controller.updateFolder('fol-1', req, { name: 'New', parentId: null });
      expect(result).toEqual({ id: 'fol-1', name: 'New' });
      expect(serviceMock.updateFolder).toHaveBeenCalledWith('user-1', 'fol-1', { name: 'New', parentId: null });
    });
  });

  // ── DELETE /cloud-storage/folders/:id ────────────────────────────────────────

  describe('deleteFolder()', () => {
    it('supprime le dossier et ne retourne rien', async () => {
      serviceMock.deleteFolder.mockResolvedValue(undefined);
      await expect(controller.deleteFolder('fol-1', req)).resolves.toBeUndefined();
      expect(serviceMock.deleteFolder).toHaveBeenCalledWith('user-1', 'fol-1');
    });
  });

  // ── POST /cloud-storage/:provider/upload ─────────────────────────────────────

  describe('uploadFile()', () => {
    const file = { originalname: 'doc.pdf', buffer: Buffer.from('enc'), mimetype: 'application/octet-stream' };

    it('uploade avec le folderId fourni et retourne le fileId', async () => {
      serviceMock.uploadFile.mockResolvedValue({ fileId: 'db-1' });
      const result = await controller.uploadFile('google-drive', req, file, 'enc-fek', undefined, 'fol-1');
      expect(result).toMatchObject({ fileId: 'db-1' });
      expect(serviceMock.uploadFile).toHaveBeenCalledWith(
        'google-drive', 'doc.pdf', file.buffer, 'application/octet-stream', 'user-1', 'enc-fek', 'fol-1', undefined, null, 'preserve', [],
      );
    });

    it('passe null pour la racine quand folderId est absent', async () => {
      serviceMock.uploadFile.mockResolvedValue({ fileId: 'db-2' });
      await controller.uploadFile('google-drive', req, file, 'enc-fek', undefined);
      expect(serviceMock.uploadFile).toHaveBeenCalledWith(
        'google-drive', 'doc.pdf', file.buffer, 'application/octet-stream', 'user-1', 'enc-fek', null, undefined, null, 'preserve', [],
      );
    });
  });

  // ── GET /cloud-storage/files/:fileId/download ────────────────────────────────

  describe('downloadFile()', () => {
    it('renvoie le buffer chiffré avec le bon Content-Type', async () => {
      const buffer = Buffer.from('encrypted');
      serviceMock.downloadFile.mockResolvedValue(buffer);
      const res = { set: jest.fn(), send: jest.fn() };

      await controller.downloadFile('db-1', req, res);

      expect(serviceMock.downloadFile).toHaveBeenCalledWith('db-1', 'user-1');
      expect(res.set).toHaveBeenCalledWith({ 'Content-Type': 'application/octet-stream' });
      expect(res.send).toHaveBeenCalledWith(buffer);
    });
  });

  // ── PATCH /cloud-storage/files/:fileId ───────────────────────────────────────

  describe('updateFile()', () => {
    it('renomme/déplace via le service', async () => {
      serviceMock.updateFile.mockResolvedValue(undefined);
      const result = await controller.updateFile('db-1', req, { folderId: 'fol-2' });
      expect(result).toMatchObject({ message: expect.any(String) });
      expect(serviceMock.updateFile).toHaveBeenCalledWith('user-1', 'db-1', { folderId: 'fol-2' });
    });
  });

  // ── file shares ─────────────────────────────────────────────────────────────

  describe('file shares', () => {
    it('liste les partages du fichier', async () => {
      serviceMock.listFileShares.mockResolvedValue([{ userId: 'user-2' }]);
      const result = await controller.listFileShares('db-1', req);
      expect(result).toEqual({ shares: [{ userId: 'user-2' }] });
      expect(serviceMock.listFileShares).toHaveBeenCalledWith('user-1', 'db-1');
    });

    it('partage le fichier avec un destinataire', async () => {
      serviceMock.shareFile.mockResolvedValue({ userId: 'user-2', read: true });
      const result = await controller.shareFile('db-1', req, {
        recipientUserId: 'user-2',
        enc_fek: 'enc',
      });
      expect(result).toEqual({ share: { userId: 'user-2', read: true } });
      expect(serviceMock.shareFile).toHaveBeenCalledWith('user-1', 'db-1', 'user-2', 'enc', true, false);
    });

    it('révoque le partage', async () => {
      serviceMock.revokeFileShare.mockResolvedValue(undefined);
      await expect(controller.revokeFileShare('db-1', 'user-2', req)).resolves.toBeUndefined();
      expect(serviceMock.revokeFileShare).toHaveBeenCalledWith('user-1', 'db-1', 'user-2');
    });
  });

  // ── DELETE /cloud-storage/files/:fileId ──────────────────────────────────────

  describe('deleteFile()', () => {
    it('supprime le fichier et ne retourne rien', async () => {
      serviceMock.deleteFile.mockResolvedValue(undefined);
      await expect(controller.deleteFile('db-1', req)).resolves.toBeUndefined();
      expect(serviceMock.deleteFile).toHaveBeenCalledWith('db-1', 'user-1');
    });
  });

  // ── GET /cloud-storage/providers ─────────────────────────────────────────────

  describe('providersStatus()', () => {
    it('retourne le statut de connexion des stockages', async () => {
      const status = { 'google-drive': { connected: true }, dropbox: { connected: false } };
      serviceMock.getProvidersStatus.mockResolvedValue(status);
      const result = await controller.providersStatus(req);
      expect(result).toBe(status);
      expect(serviceMock.getProvidersStatus).toHaveBeenCalledWith('user-1');
    });
  });

  // ── GET /cloud-storage/:provider/connect ─────────────────────────────────────

  describe('connect()', () => {
    it("retourne l'URL de consentement OAuth", async () => {
      serviceMock.getConnectUrl.mockResolvedValue('https://accounts.google.com/o/oauth2/...');
      const result = await controller.connect('google-drive', req);
      expect(result).toEqual({ url: 'https://accounts.google.com/o/oauth2/...' });
      expect(serviceMock.getConnectUrl).toHaveBeenCalledWith('google-drive', 'user-1');
    });
  });
});
