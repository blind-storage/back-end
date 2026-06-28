import { Test, TestingModule } from '@nestjs/testing';
import {
  OidcProvider,
  OidcSetupDto,
  Role,
  TotpRecoverDto,
} from '@blind-storage/types';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './guards/google-auth/jwt-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth/local-auth.guard';
import { RezelAuthGuard } from './guards/rezel-auth/jwt-auth.guard';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'uuid-1',
  email: 'alice@example.com',
  username: 'alice42',
  role: Role.USER,
  pub_key: 'pub-key-alice',
  priv_key_enc_1: 'enc1',
  priv_key_enc_2: 'enc2',
  totpEnabled: false,
};

const mockPendingResponse = {
  setup_required: true as const,
  setup_token: 'pending.jwt.token',
  email: 'alice@example.com',
};

const authServiceMock = {
  login: jest.fn().mockReturnValue({ access_token: 'signed.jwt.token' }),
  handleOidcCallback: jest.fn(),
  completeOidcSetup: jest.fn(),
  recoverWithCode: jest.fn(),
};

const guardAllow = { canActivate: () => true };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    })
      .overrideGuard(LocalAuthGuard)
      .useValue(guardAllow)
      .overrideGuard(JwtAuthGuard)
      .useValue(guardAllow)
      .overrideGuard(GoogleAuthGuard)
      .useValue(guardAllow)
      .overrideGuard(RezelAuthGuard)
      .useValue(guardAllow)
      .compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
    authServiceMock.login.mockReturnValue({ access_token: 'signed.jwt.token' });
  });

  // ── POST /auth/login ────────────────────────────────────────────────────────

  describe('login()', () => {
    it("retourne l'access_token fourni par le service", () => {
      const req = { user: mockUser };
      const result = controller.login(req);

      expect(result.access_token).toBe('signed.jwt.token');
      expect(authServiceMock.login).toHaveBeenCalledWith(mockUser);
    });
  });

  // ── GET /auth/profile ───────────────────────────────────────────────────────

  describe('profile()', () => {
    it('retourne le JwtUser extrait de req.user', () => {
      const req = { user: mockUser };
      const result = controller.profile(req);

      expect(result.id).toBe('uuid-1');
      expect(result.email).toBe('alice@example.com');
    });
  });

  // ── GET /auth/google/callback ───────────────────────────────────────────────
  // Les callbacks OIDC redirigent vers le frontend (token / setup_token / link_token
  // en query string) au lieu de retourner du JSON.

  describe('googleCallback()', () => {
    it('redirige vers le frontend avec un token si le compte existe', () => {
      authServiceMock.handleOidcCallback.mockReturnValue({
        access_token: 'signed.jwt.token',
      });
      const res = { redirect: jest.fn() } as any;

      controller.googleCallback({ user: mockUser }, res);

      expect(authServiceMock.handleOidcCallback).toHaveBeenCalledWith(mockUser);
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('token=signed.jwt.token'),
      );
    });

    it('redirige avec un setup_token si premier accès', () => {
      authServiceMock.handleOidcCallback.mockReturnValue(mockPendingResponse);
      const pending = {
        pendingSetup: true,
        provider: OidcProvider.GOOGLE,
        providerUserId: 'g1',
        email: 'alice@example.com',
        accessToken: 'token',
        refreshToken: null,
      };
      const res = { redirect: jest.fn() } as any;

      controller.googleCallback({ user: pending }, res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('setup_token=pending.jwt.token'),
      );
    });
  });

  // ── GET /auth/rezel/callback ────────────────────────────────────────────────

  describe('rezelCallback()', () => {
    it('redirige vers le frontend avec un token si le compte existe', () => {
      authServiceMock.handleOidcCallback.mockReturnValue({
        access_token: 'signed.jwt.token',
      });
      const res = { redirect: jest.fn() } as any;

      controller.rezelCallback({ user: mockUser }, res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('token=signed.jwt.token'),
      );
    });

    it('redirige avec un setup_token si premier accès', () => {
      authServiceMock.handleOidcCallback.mockReturnValue(mockPendingResponse);
      const pending = {
        pendingSetup: true,
        provider: OidcProvider.REZEL,
        providerUserId: 'r1',
        email: 'alice@rezel.net',
        accessToken: 'token',
        refreshToken: null,
      };
      const res = { redirect: jest.fn() } as any;

      controller.rezelCallback({ user: pending }, res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('setup_token=pending.jwt.token'),
      );
    });
  });

  // ── POST /auth/oidc/setup ───────────────────────────────────────────────────

  describe('oidcSetup()', () => {
    it('délègue au service et retourne le JWT', async () => {
      authServiceMock.completeOidcSetup.mockResolvedValue({
        access_token: 'final.jwt.token',
      });
      const dto: OidcSetupDto = {
        setup_token: 'pending.jwt.token',
        username: 'alice42',
        auth_hash: 'derived-auth-hash',
        pub_key: 'pub-key',
        priv_key_enc_1: 'enc1',
        priv_key_enc_2: 'enc2',
        salt_mp: 'salt1',
        salt_rc: 'salt2',
        tree_enc_key: 'tree-key',
      };

      const result = await controller.oidcSetup(dto);

      expect(result.access_token).toBe('final.jwt.token');
    });
  });

  // ── POST /auth/totp/recover ─────────────────────────────────────────────────

  describe('totpRecover()', () => {
    it('appelle recoverWithCode et retourne un JWT', async () => {
      authServiceMock.recoverWithCode.mockResolvedValue({
        access_token: 'recovered.jwt',
      });
      const dto: TotpRecoverDto = {
        username: 'alice42',
        password: 'P@ss!',
        recovery_code: 'A1B2-C3D4-E5F6-7890',
      };

      const result = await controller.totpRecover(dto);

      expect(result.access_token).toBe('recovered.jwt');
      expect(authServiceMock.recoverWithCode).toHaveBeenCalledWith(
        'alice42',
        'P@ss!',
        'A1B2-C3D4-E5F6-7890',
      );
    });
  });
});
