import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { CreateUserDto, UpdateUserDto } from '@blind-storage/types';
import { UsersService } from './users.service';
import type { UserModel } from '../generated/prisma/models/User';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeUser = (overrides: Partial<UserModel> = {}): UserModel => ({
  id: 'uuid-1',
  email: 'alice@example.com',
  username: 'alice42',
  auth_hash: '$argon2id$...',
  salt_mp: 'salt1',
  salt_rc: 'salt2',
  pub_key: 'pub-key-alice',
  priv_key_enc_1: 'enc1-alice',
  priv_key_enc_2: 'enc2-alice',
  totpSecret: null,
  totpEnabled: false,
  ...overrides,
} as UserModel);

const createDto: CreateUserDto = {
  email: 'alice@example.com',
  username: 'alice42',
  auth_hash: '$argon2id$...',
  salt_mp: 'salt1',
  salt_rc: 'salt2',
  pub_key: 'pub-key-alice',
  priv_key_enc_1: 'enc1-alice',
  priv_key_enc_2: 'enc2-alice',
  tree_enc_key: 'treekey',
};

// ─── Mock PrismaService ───────────────────────────────────────────────────────

const prismaMock = {
  user: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  totpRecoveryCode: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('crée un utilisateur quand email et username sont libres', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(makeUser());

      const result = await service.create(createDto);

      expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('uuid-1');
    });

    it('lève ConflictException si email déjà pris', async () => {
      prismaMock.user.findFirst.mockResolvedValue(makeUser());

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('lève ConflictException si username déjà pris', async () => {
      prismaMock.user.findFirst.mockResolvedValue(
        makeUser({ email: 'other@example.com', username: 'alice42' }),
      );

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('retourne la liste de tous les utilisateurs', async () => {
      const users = [makeUser(), makeUser({ id: 'uuid-2', email: 'bob@example.com', username: 'bob' })];
      prismaMock.user.findMany.mockResolvedValue(users);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith({ orderBy: { username: 'asc' } });
    });
  });

  // ── findOne ─────────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it("retourne l'utilisateur si trouvé", async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser());

      const result = await service.findOne('uuid-1');
      expect(result.id).toBe('uuid-1');
    });

    it('lève NotFoundException si absent', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('unknown-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── findByEmail ─────────────────────────────────────────────────────────────

  describe('findByEmail()', () => {
    it("retourne l'utilisateur correspondant", async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser());
      const result = await service.findByEmail('alice@example.com');
      expect(result?.email).toBe('alice@example.com');
    });

    it('retourne null si aucun utilisateur', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      const result = await service.findByEmail('nobody@example.com');
      expect(result).toBeNull();
    });
  });

  // ── update ──────────────────────────────────────────────────────────────────

  describe('update()', () => {
    const updateDto: UpdateUserDto = { username: 'alice-new' };

    it("met à jour l'utilisateur", async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser());
      prismaMock.user.findFirst.mockResolvedValue(null);
      prismaMock.user.update.mockResolvedValue(makeUser({ username: 'alice-new' }));

      const result = await service.update('uuid-1', updateDto);
      expect(result.username).toBe('alice-new');
    });

    it("lève NotFoundException si l'utilisateur est absent", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.update('bad-id', updateDto)).rejects.toThrow(NotFoundException);
    });

    it('lève ConflictException si le nouveau username est déjà pris', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser());
      prismaMock.user.findFirst.mockResolvedValue(makeUser({ id: 'uuid-2', username: 'alice-new' }));

      await expect(service.update('uuid-1', updateDto)).rejects.toThrow(ConflictException);
    });
  });

  // ── remove ──────────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it("supprime l'utilisateur", async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser());
      prismaMock.user.delete.mockResolvedValue(makeUser());

      await expect(service.remove('uuid-1')).resolves.toBeUndefined();
      expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'uuid-1' } });
    });

    it('lève NotFoundException si absent', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.remove('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── TOTP ────────────────────────────────────────────────────────────────────

  describe('enableTotp()', () => {
    it('active le TOTP, stocke 10 codes hachés et retourne les codes en clair', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser());
      prismaMock.totpRecoveryCode.deleteMany.mockResolvedValue({ count: 0 });
      prismaMock.totpRecoveryCode.createMany.mockResolvedValue({ count: 10 });
      prismaMock.user.update.mockResolvedValue(
        makeUser({ totpEnabled: true, totpSecret: 'SECRET123' }),
      );

      const { user, recoveryCodes } = await service.enableTotp('uuid-1', 'SECRET123');

      expect(user.totpEnabled).toBe(true);
      expect(recoveryCodes).toHaveLength(10);
      expect(recoveryCodes[0]).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
      expect(prismaMock.totpRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'uuid-1' } });
      expect(prismaMock.totpRecoveryCode.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ userId: 'uuid-1' })]) }),
      );
    });

    it('lève NotFoundException si utilisateur absent', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(service.enableTotp('bad-id', 'S')).rejects.toThrow(NotFoundException);
    });
  });

  describe('disableTotp()', () => {
    it('désactive le TOTP, efface le secret et purge les codes de récupération', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ totpEnabled: true, totpSecret: 'S' }));
      prismaMock.totpRecoveryCode.deleteMany.mockResolvedValue({ count: 3 });
      prismaMock.user.update.mockResolvedValue(makeUser({ totpEnabled: false, totpSecret: null }));

      const result = await service.disableTotp('uuid-1');

      expect(result.totpEnabled).toBe(false);
      expect(result.totpSecret).toBeNull();
      expect(prismaMock.totpRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'uuid-1' } });
    });
  });

  // ── consumeRecoveryCode ──────────────────────────────────────────────────────

  describe('consumeRecoveryCode()', () => {
    it('retourne true et marque le code comme utilisé si valide', async () => {
      prismaMock.totpRecoveryCode.findFirst.mockResolvedValue({ id: 'code-id' });
      prismaMock.totpRecoveryCode.update.mockResolvedValue({});

      const result = await service.consumeRecoveryCode('uuid-1', 'A1B2-C3D4-E5F6-7890');

      expect(result).toBe(true);
      expect(prismaMock.totpRecoveryCode.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'code-id' }, data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
      );
    });

    it('retourne false si le code est invalide ou déjà utilisé', async () => {
      prismaMock.totpRecoveryCode.findFirst.mockResolvedValue(null);

      const result = await service.consumeRecoveryCode('uuid-1', 'BAD-CODE');
      expect(result).toBe(false);
    });
  });
});
