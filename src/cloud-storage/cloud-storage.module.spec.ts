import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { PrismaService } from '../prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { CloudStorageController } from './cloud-storage.controller';
import { CloudStorageService } from './cloud-storage.service';
import { DropboxService } from './providers/dropbox.service';
import { GoogleDriveService } from './providers/google-drive.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const prismaMock = {
  file: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  filePermission: { findUnique: jest.fn() },
  oidcConnection: { findUnique: jest.fn(), update: jest.fn() },
};

const configServiceMock = {
  getOrThrow: jest.fn().mockReturnValue('mock-value'),
};

const loggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CloudStorageModule (composition)', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [CloudStorageController],
      providers: [
        CloudStorageService,
        GoogleDriveService,
        DropboxService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configServiceMock },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verify: jest.fn() },
        },
        { provide: WINSTON_MODULE_PROVIDER, useValue: loggerMock },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn().mockReturnValue(true) },
        },
      ],
    }).compile();
  });

  afterEach(() => jest.clearAllMocks());

  it('compile sans erreur', () => {
    expect(module).toBeDefined();
  });

  it('fournit CloudStorageService', () => {
    expect(module.get(CloudStorageService)).toBeInstanceOf(CloudStorageService);
  });

  it('fournit GoogleDriveService', () => {
    expect(module.get(GoogleDriveService)).toBeInstanceOf(GoogleDriveService);
  });

  it('fournit DropboxService', () => {
    expect(module.get(DropboxService)).toBeInstanceOf(DropboxService);
  });

  it('enregistre CloudStorageController', () => {
    expect(module.get(CloudStorageController)).toBeInstanceOf(
      CloudStorageController,
    );
  });

  it('CloudStorageService expose les méthodes attendues', () => {
    const service = module.get<CloudStorageService>(CloudStorageService);
    expect(typeof service.uploadFile).toBe('function');
    expect(typeof service.listFiles).toBe('function');
    expect(typeof service.downloadFile).toBe('function');
    expect(typeof service.deleteFile).toBe('function');
    expect(typeof service.listProviderFiles).toBe('function');
  });
});
