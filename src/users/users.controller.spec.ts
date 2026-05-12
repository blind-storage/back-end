import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '../generated/prisma/enums';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { SelfOrAdminGuard } from '../auth/guards/self-or-admin/self-or-admin.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'uuid-1',
  email: 'alice@example.com',
  username: 'alice42',
  role: Role.USER,
  auth_hash: '$argon2id$...',
  salt_mp: 'salt1',
  salt_rc: 'salt2',
  pub_key: 'pub-key-alice',
  priv_key_enc_1: 'enc1',
  priv_key_enc_2: 'enc2',
  tree_enc_key: 'treekey',
  totpSecret: null,
  totpEnabled: false,
};

const usersServiceMock = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  enableTotp: jest.fn(),
  disableTotp: jest.fn(),
};

const guardAllow = { canActivate: () => true };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersServiceMock }],
    })
      .overrideGuard(JwtAuthGuard).useValue(guardAllow)
      .overrideGuard(RolesGuard).useValue(guardAllow)
      .overrideGuard(SelfOrAdminGuard).useValue(guardAllow)
      .compile();

    controller = module.get<UsersController>(UsersController);
    jest.clearAllMocks();
  });

  // ── POST /users ─────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('retourne un UserEntity sans champs sensibles', async () => {
      usersServiceMock.create.mockResolvedValue(mockUser);
      const dto: CreateUserDto = {
        email: 'alice@example.com',
        username: 'alice42',
        pub_key: 'pub-key-alice',
        priv_key_enc_1: 'enc1',
        priv_key_enc_2: 'enc2',
        auth_hash: '$argon2id$...',
        salt_mp: 'salt1',
        salt_rc: 'salt2',
        tree_enc_key: 'treekey',
      };

      const result = await controller.create(dto);

      expect(result.id).toBe('uuid-1');
      expect(result.email).toBe('alice@example.com');
      expect(result.role).toBe(Role.USER);
      expect((result as any).auth_hash).toBeUndefined();
      expect((result as any).salt_mp).toBeUndefined();
    });
  });

  // ── GET /users ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('retourne la liste des utilisateurs', async () => {
      usersServiceMock.findAll.mockResolvedValue([mockUser]);

      const result = await controller.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('alice42');
    });
  });

  // ── GET /users/:id ──────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it("retourne l'utilisateur correspondant", async () => {
      usersServiceMock.findOne.mockResolvedValue(mockUser);

      const result = await controller.findOne('uuid-1');

      expect(result.id).toBe('uuid-1');
    });

    it('propage NotFoundException du service', async () => {
      usersServiceMock.findOne.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── PATCH /users/:id ────────────────────────────────────────────────────────

  describe('update()', () => {
    it("met à jour et retourne l'utilisateur", async () => {
      const updated = { ...mockUser, username: 'alice-new' };
      usersServiceMock.update.mockResolvedValue(updated);
      const dto: UpdateUserDto = { username: 'alice-new' };

      const result = await controller.update('uuid-1', dto);

      expect(result.username).toBe('alice-new');
      expect(usersServiceMock.update).toHaveBeenCalledWith('uuid-1', dto);
    });
  });

  // ── DELETE /users/:id ───────────────────────────────────────────────────────

  describe('remove()', () => {
    it('appelle service.remove et ne retourne rien', async () => {
      usersServiceMock.remove.mockResolvedValue(undefined);

      await expect(controller.remove('uuid-1')).resolves.toBeUndefined();
      expect(usersServiceMock.remove).toHaveBeenCalledWith('uuid-1');
    });
  });

  // ── TOTP ────────────────────────────────────────────────────────────────────

  describe('enableTotp()', () => {
    it('retourne user + codes de récupération', async () => {
      const codes = ['A1B2-C3D4-E5F6-7890', 'FFFF-EEEE-DDDD-CCCC'];
      usersServiceMock.enableTotp.mockResolvedValue({ user: { ...mockUser, totpEnabled: true }, recoveryCodes: codes });

      const result = await controller.enableTotp('uuid-1', 'TOTP_SECRET');

      expect(result.user.totpEnabled).toBe(true);
      expect(result.recovery_codes).toHaveLength(2);
      expect(usersServiceMock.enableTotp).toHaveBeenCalledWith('uuid-1', 'TOTP_SECRET');
    });
  });

  describe('disableTotp()', () => {
    it('désactive le TOTP et retourne le user mis à jour', async () => {
      const updated = { ...mockUser, totpEnabled: false };
      usersServiceMock.disableTotp.mockResolvedValue(updated);

      const result = await controller.disableTotp('uuid-1');

      expect(result.totpEnabled).toBe(false);
    });
  });
});
