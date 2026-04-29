import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { UserModel } from '../generated/prisma/models/User';
import { PrismaService } from '../prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Create ────────────────────────────────────────────────────────────────

  async create(dto: CreateUserDto): Promise<UserModel> {
    this.logger.log(`Creating user: ${dto.email}`);

    // Vérification unicité avant insert pour un message d'erreur explicite
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { username: dto.username }],
      },
    });

    if (existing) {
      const field = existing.email === dto.email ? 'email' : 'username';
      this.logger.warn(`Conflict on field "${field}" for value "${dto[field]}"`);
      throw new ConflictException(`Un utilisateur avec cet ${field} existe déjà.`);
    }

    try {
      const user = await this.prisma.user.create({ data: dto });
      this.logger.log(`User created successfully: ${user.id}`);
      return user;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to create user: ${err.message}`, err.stack);
      throw error;
    }
  }

  // ─── Find all ──────────────────────────────────────────────────────────────

  async findAll(): Promise<UserModel[]> {
    this.logger.log('Fetching all users');
    return this.prisma.user.findMany({
      orderBy: { username: 'asc' },
    });
  }

  // ─── Find one by ID ────────────────────────────────────────────────────────

  async findOne(id: string): Promise<UserModel> {
    this.logger.log(`Fetching user: ${id}`);
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      this.logger.warn(`User not found: ${id}`);
      throw new NotFoundException(`Utilisateur introuvable (id: ${id})`);
    }

    return user;
  }

  // ─── Find by email (utilisé par AuthService) ───────────────────────────────

  async findByEmail(email: string): Promise<UserModel | null> {
    this.logger.log(`Fetching user by email: ${email}`);
    return this.prisma.user.findUnique({ where: { email } });
  }

  // ─── Find by username ──────────────────────────────────────────────────────

  async findByUsername(username: string): Promise<UserModel | null> {
    this.logger.log(`Fetching user by username: ${username}`);
    return this.prisma.user.findUnique({ where: { username } });
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateUserDto): Promise<UserModel> {
    this.logger.log(`Updating user: ${id}`);
    await this.findOne(id); // lance NotFoundException si absent

    // Vérifier unicité email/username si modifiés
    if (dto.email || dto.username) {
      const conflict = await this.prisma.user.findFirst({
        where: {
          AND: [
            { id: { not: id } },
            {
              OR: [
                ...(dto.email ? [{ email: dto.email }] : []),
                ...(dto.username ? [{ username: dto.username }] : []),
              ],
            },
          ],
        },
      });

      if (conflict) {
        const field = conflict.email === dto.email ? 'email' : 'username';
        throw new ConflictException(`Un utilisateur avec cet ${field} existe déjà.`);
      }
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data: dto,
      });
      this.logger.log(`User updated: ${id}`);
      return updated;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to update user ${id}: ${err.message}`, err.stack);
      throw error;
    }
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  async remove(id: string): Promise<void> {
    this.logger.log(`Deleting user: ${id}`);
    await this.findOne(id); // lance NotFoundException si absent

    try {
      await this.prisma.user.delete({ where: { id } });
      this.logger.log(`User deleted: ${id}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to delete user ${id}: ${err.message}`, err.stack);
      throw error;
    }
  }

  // ─── TOTP helpers ─────────────────────────────────────────────────────────

  async enableTotp(id: string, secret: string): Promise<UserModel> {
    this.logger.log(`Enabling TOTP for user: ${id}`);
    await this.findOne(id);
    return this.prisma.user.update({
      where: { id },
      data: { totpEnabled: true, totpSecret: secret },
    });
  }

  async disableTotp(id: string): Promise<UserModel> {
    this.logger.log(`Disabling TOTP for user: ${id}`);
    await this.findOne(id);
    return this.prisma.user.update({
      where: { id },
      data: { totpEnabled: false, totpSecret: null },
    });
  }
}