import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CloudStorageConnectController } from './cloud-storage-connect.controller';
import { CloudStorageService } from './cloud-storage.service';

const serviceMock = { handleConnectCallback: jest.fn() };
const configMock = { get: jest.fn().mockReturnValue('http://localhost:8000') };

describe('CloudStorageConnectController', () => {
  let controller: CloudStorageConnectController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudStorageConnectController],
      providers: [
        { provide: CloudStorageService, useValue: serviceMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    controller = module.get<CloudStorageConnectController>(
      CloudStorageConnectController,
    );
    jest.clearAllMocks();
    configMock.get.mockReturnValue('http://localhost:8000');
  });

  it('redirige vers ?connected=<provider> en cas de succès', async () => {
    serviceMock.handleConnectCallback.mockResolvedValue('user-1');
    const res = { redirect: jest.fn() };

    await controller.callback(
      'google-drive',
      'auth-code',
      'signed-state',
      undefined,
      res as any,
    );

    expect(serviceMock.handleConnectCallback).toHaveBeenCalledWith(
      'google-drive',
      'auth-code',
      'signed-state',
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'http://localhost:8000/storage?connected=google-drive',
    );
  });

  it('redirige vers ?error si le provider renvoie une erreur', async () => {
    const res = { redirect: jest.fn() };
    await controller.callback(
      'google-drive',
      undefined,
      undefined,
      'access_denied',
      res as any,
    );

    expect(serviceMock.handleConnectCallback).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/storage?error='),
    );
  });

  it('redirige vers ?error si code ou state est manquant', async () => {
    const res = { redirect: jest.fn() };
    await controller.callback(
      'google-drive',
      undefined,
      'state-only',
      undefined,
      res as any,
    );

    expect(serviceMock.handleConnectCallback).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/storage?error='),
    );
  });

  it('redirige vers ?error si le service échoue', async () => {
    serviceMock.handleConnectCallback.mockRejectedValue(
      new Error('state expiré'),
    );
    const res = { redirect: jest.fn() };

    await controller.callback(
      'google-drive',
      'auth-code',
      'bad-state',
      undefined,
      res as any,
    );

    expect(res.redirect).toHaveBeenCalledWith(
      'http://localhost:8000/storage?error=state%20expir%C3%A9',
    );
  });
});
