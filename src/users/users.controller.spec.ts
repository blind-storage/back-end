import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'uuid-1',
  email: 'alice@example.com',
  username: 'alice42',
  auth_hash: '$argon2id$...',
  salt_mp: 'salt1',
  salt_rc: 'salt2',
  pub_key: 'pub-key-alice',
  priv_key_enc_1: 'enc1',
  priv_key_enc_2: 'enc2',
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersServiceMock }],
    }).compile();

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
      };

      const result = await controller.create(dto);

      expect(result.id).toBe('uuid-1');
      expect(result.email).toBe('alice@example.com');
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
      expect(usersServiceMock.findOne).toHaveBeenCalledWith('uuid-1');
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
    it('active le TOTP', async () => {
      const updated = { ...mockUser, totpEnabled: true, totpSecret: 'S123' };
      usersServiceMock.enableTotp.mockResolvedValue(updated);

      const result = await controller.enableTotp('uuid-1', 'S123');

      expect(result.totpEnabled).toBe(true);
      expect(usersServiceMock.enableTotp).toHaveBeenCalledWith('uuid-1', 'S123');
    });
  });

  describe('disableTotp()', () => {
    it('désactive le TOTP', async () => {
      const updated = { ...mockUser, totpEnabled: false, totpSecret: null };
      usersServiceMock.disableTotp.mockResolvedValue(updated);

      const result = await controller.disableTotp('uuid-1');

      expect(result.totpEnabled).toBe(false);
    });
  });
});
