import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { OidcProvider, OidcSetupDto } from '@blind-storage/types';
import type { PendingOidcProfile } from '@blind-storage/types';
import type { UserModel } from '../generated/prisma/models/User';
import { PrismaService } from '../prisma.service';
import { PkiService } from '../pki/pki.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

// Modèle "blind" : le client dérive l'auth_hash côté navigateur et l'envoie dans
// le champ `password`. Le serveur le compare (timingSafeEqual) au hash stocké —
// pas de bcrypt côté serveur. Le mot de passe valide est donc l'auth_hash stocké.
const AUTH_HASH = '$2b$10$hashedpassword';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeUser = (overrides: Partial<UserModel> = {}): UserModel =>
  ({
    id: 'uuid-1',
    email: 'alice@example.com',
    username: 'alice42',
    auth_hash: AUTH_HASH,
    salt_mp: 'salt1',
    salt_rc: 'salt2',
    pub_key: 'pub-key-alice',
    priv_key_enc_1: 'enc1',
    priv_key_enc_2: 'enc2',
    totpSecret: null,
    totpEnabled: false,
    ...overrides,
  }) as UserModel;

const makePendingProfile = (
  overrides: Partial<PendingOidcProfile> = {},
): PendingOidcProfile => ({
  pendingSetup: true,
  provider: OidcProvider.GOOGLE,
  providerUserId: 'google-uid-1',
  email: 'alice@example.com',
  accessToken: 'goog-access',
  refreshToken: 'goog-refresh',
  ...overrides,
});

const makeOidcSetupDto = (
  overrides: Partial<OidcSetupDto> = {},
): OidcSetupDto => ({
  setup_token: 'valid.pending.token',
  username: 'alice42',
  auth_hash: AUTH_HASH,
  pub_key: 'pub-key',
  priv_key_enc_1: 'enc1',
  priv_key_enc_2: 'enc2',
  salt_mp: 'salt1',
  salt_rc: 'salt2',
  tree_enc_key: 'tree-key',
  ...overrides,
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

const usersServiceMock = {
  findByUsername: jest.fn(),
};

const jwtServiceMock = {
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
  verify: jest.fn(),
};

const prismaMock = {
  oidcConnection: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  user: {
    create: jest.fn(),
    update: jest.fn(),
  },
  totpRecoveryCode: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const pkiServiceMock = {
  isConfigured: jest.fn().mockReturnValue(false),
  issueCertificate: jest.fn(),
  revokeCertificate: jest.fn().mockResolvedValue(undefined),
  computeFingerprint: jest.fn().mockReturnValue('fingerprint'),
  getCrl: jest.fn(),
  getCaPublicKey: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersServiceMock },
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: PkiService, useValue: pkiServiceMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    jwtServiceMock.sign.mockReturnValue('signed.jwt.token');
    prismaMock.$transaction.mockImplementation(
      async (fn: any) => await fn(prismaMock),
    );
  });

  // ── validateUser ────────────────────────────────────────────────────────────

  describe('validateUser()', () => {
    it("retourne l'utilisateur si les identifiants sont corrects", async () => {
      usersServiceMock.findByUsername.mockResolvedValue(makeUser());

      // Le client envoie l'auth_hash, comparé au hash stocké.
      const result = await service.validateUser('alice42', AUTH_HASH);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('uuid-1');
    });

    it('retourne null si utilisateur introuvable', async () => {
      usersServiceMock.findByUsername.mockResolvedValue(null);

      expect(await service.validateUser('unknown', 'any')).toBeNull();
    });

    it("retourne null si l'utilisateur n'a pas de mot de passe (OIDC seul)", async () => {
      usersServiceMock.findByUsername.mockResolvedValue(
        makeUser({ auth_hash: null }),
      );
      expect(await service.validateUser('alice42', 'any')).toBeNull();
    });

    it('retourne null si le mot de passe est incorrect', async () => {
      usersServiceMock.findByUsername.mockResolvedValue(makeUser());
      expect(await service.validateUser('alice42', 'wrong')).toBeNull();
    });
  });

  // ── login ───────────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('retourne un access_token signé avec le bon payload (inclut role)', () => {
      const user = makeUser();
      const result = service.login(user);

      expect(result.access_token).toBe('signed.jwt.token');
      expect(jwtServiceMock.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'uuid-1',
          email: 'alice@example.com',
          username: 'alice42',
        }),
      );
    });
  });

  // ── handleOidcCallback ──────────────────────────────────────────────────────

  describe('handleOidcCallback()', () => {
    it('émet un JWT si le compte existe déjà', () => {
      const result = service.handleOidcCallback(makeUser());
      expect(result).toHaveProperty('access_token', 'signed.jwt.token');
    });

    it('retourne un pending response si premier accès', () => {
      const result = service.handleOidcCallback(makePendingProfile());
      expect(result).toHaveProperty('setup_required', true);
      expect(result).toHaveProperty('setup_token');
    });
  });

  // ── generatePendingResponse ─────────────────────────────────────────────────

  describe('generatePendingResponse()', () => {
    it('signe un token pending 15m et retourne setup_required', () => {
      const result = service.generatePendingResponse(makePendingProfile());

      expect(result.setup_required).toBe(true);
      expect(result.email).toBe('alice@example.com');
      expect(jwtServiceMock.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          pending: true,
          provider: OidcProvider.GOOGLE,
        }),
        { expiresIn: '15m' },
      );
    });
  });

  // ── completeOidcSetup ───────────────────────────────────────────────────────

  describe('completeOidcSetup()', () => {
    const pendingPayload = {
      pending: true,
      provider: OidcProvider.GOOGLE,
      providerUserId: 'google-uid-1',
      email: 'alice@example.com',
      accessToken: 'access',
      refreshToken: null,
    };

    it('crée user + connexion OIDC et retourne un JWT', async () => {
      jwtServiceMock.verify.mockReturnValue(pendingPayload);
      prismaMock.oidcConnection.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(makeUser());
      prismaMock.user.update.mockResolvedValue(
        makeUser({ key_fingerprint: 'fingerprint' }),
      );
      prismaMock.oidcConnection.create.mockResolvedValue({});

      const result = await service.completeOidcSetup(makeOidcSetupDto());

      expect(result.access_token).toBe('signed.jwt.token');
      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ auth_hash: AUTH_HASH }),
        }),
      );
    });

    it('lève UnauthorizedException si le token est invalide', async () => {
      jwtServiceMock.verify.mockImplementation(() => {
        throw new Error('invalid');
      });
      await expect(
        service.completeOidcSetup(makeOidcSetupDto()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("lève UnauthorizedException si le token n'est pas pending", async () => {
      jwtServiceMock.verify.mockReturnValue({
        sub: 'uuid-1',
        email: 'alice@example.com',
      });
      await expect(
        service.completeOidcSetup(makeOidcSetupDto()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lève ConflictException si le compte est déjà lié', async () => {
      jwtServiceMock.verify.mockReturnValue(pendingPayload);
      prismaMock.oidcConnection.findUnique.mockResolvedValue({
        id: 'existing',
      });
      await expect(
        service.completeOidcSetup(makeOidcSetupDto()),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── recoverWithCode ─────────────────────────────────────────────────────────

  describe('recoverWithCode()', () => {
    it('valide le code, désactive le TOTP et retourne un JWT', async () => {
      usersServiceMock.findByUsername.mockResolvedValue(
        makeUser({ totpEnabled: true }),
      );
      prismaMock.totpRecoveryCode.findFirst.mockResolvedValue({
        id: 'code-id',
      });
      prismaMock.totpRecoveryCode.update.mockResolvedValue({});
      prismaMock.user.update.mockResolvedValue(
        makeUser({ totpEnabled: false }),
      );

      const result = await service.recoverWithCode(
        'alice42',
        AUTH_HASH,
        'A1B2-C3D4-E5F6-7890',
      );

      expect(result.access_token).toBe('signed.jwt.token');
      expect(prismaMock.totpRecoveryCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'code-id' },
          data: expect.objectContaining({ usedAt: expect.any(Date) }),
        }),
      );
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { totpEnabled: false, totpSecret: null },
        }),
      );
    });

    it('lève UnauthorizedException si identifiants invalides', async () => {
      usersServiceMock.findByUsername.mockResolvedValue(null);
      await expect(
        service.recoverWithCode('alice42', 'bad', 'code'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("lève BadRequestException si le TOTP n'est pas activé", async () => {
      usersServiceMock.findByUsername.mockResolvedValue(
        makeUser({ totpEnabled: false }),
      );
      await expect(
        service.recoverWithCode('alice42', AUTH_HASH, 'code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lève UnauthorizedException si le code de récupération est invalide', async () => {
      usersServiceMock.findByUsername.mockResolvedValue(
        makeUser({ totpEnabled: true }),
      );
      prismaMock.totpRecoveryCode.findFirst.mockResolvedValue(null);
      await expect(
        service.recoverWithCode('alice42', AUTH_HASH, 'BAD-CODE'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
