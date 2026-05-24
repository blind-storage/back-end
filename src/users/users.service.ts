import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type { UserModel } from '../generated/prisma/models/User';
import { PrismaService } from '../prisma.service';
import { CreateUserDto, UpdateUserDto } from '@blind-storage/types';

// ─── Helpers pour les codes de récupération ──────────────────────���─────────────

function generateRecoveryCode(): string {
  const hex = randomBytes(8).toString('hex').toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.toUpperCase()).digest('hex');
}

// ─── Service ────────────────────────────────��──────────────────────────��───────

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Create ─────────────────────────��──────────────────────────────────────

  async create(dto: CreateUserDto): Promise<UserModel> {
    this.logger.log(`Creating user: ${dto.email}`);

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { username: dto.username }] },
    });

    if (existing) {
      const field = existing.email === dto.email ? 'email' : 'username';
      this.logger.warn(`Conflict on field "${field}" for value "${dto[field as keyof typeof dto]}"`);
      throw new ConflictException(`Un utilisateur avec cet ${field} existe déjà.`);
    }

    try {
      const user = await this.prisma.user.create({ data: dto as any });
      this.logger.log(`User created successfully: ${user.id}`);
      return user;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to create user: ${err.message}`, err.stack);
      throw error;
    }
  }

  // ─── Find all ─────────────────────────────────���──────────────────────────��─

  async findAll(): Promise<UserModel[]> {
    this.logger.log('Fetching all users');
    return this.prisma.user.findMany({ orderBy: { username: 'asc' } });
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

  // ─── Find by email / username ─────────────────────────────���────────────────

  async findByEmail(email: string): Promise<UserModel | null> {
    this.logger.log(`Fetching user by email: ${email}`);
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByUsername(username: string): Promise<UserModel | null> {
    this.logger.log(`Fetching user by username: ${username}`);
    return this.prisma.user.findUnique({ where: { username } });
  }

  // ─── Update ─────────────────────────────────────────────────────���──────────

  async update(id: string, dto: UpdateUserDto): Promise<UserModel> {
    this.logger.log(`Updating user: ${id}`);
    await this.findOne(id);

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
      const updated = await this.prisma.user.update({ where: { id }, data: dto as any });
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
    await this.findOne(id);

    try {
      await this.prisma.user.delete({ where: { id } });
      this.logger.log(`User deleted: ${id}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to delete user ${id}: ${err.message}`, err.stack);
      throw error;
    }
  }

  // ─── Count remaining recovery codes ───────────────────────────────────────

  async countRemainingRecoveryCodes(userId: string): Promise<number> {
    return (this.prisma as any).totpRecoveryCode.count({
      where: { userId, usedAt: null },
    });
  }

  // ─── TOTP enable (génère les codes de récupération) ────────────────────────

  async enableTotp(id: string, secret: string): Promise<{ user: UserModel; recoveryCodes: string[] }> {
    this.logger.log(`Enabling TOTP for user: ${id}`);
    await this.findOne(id);

    const codes = Array.from({ length: 10 }, generateRecoveryCode);
    const hashes = codes.map(hashRecoveryCode);

    const prismaAny = this.prisma as any;

    // Purge les anciens codes
    await prismaAny.totpRecoveryCode.deleteMany({ where: { userId: id } });

    // Stocke les nouveaux codes hachés
    await prismaAny.totpRecoveryCode.createMany({
      data: hashes.map((codeHash: string) => ({ userId: id, codeHash })),
    });

    const user = await this.prisma.user.update({
      where: { id },
      data: { totpEnabled: true, totpSecret: secret },
    });

    this.logger.log(`TOTP enabled for user: ${id}`);
    return { user, recoveryCodes: codes };
  }

  // ─── TOTP disable ──────────────────────────────────────────────────────────

  async disableTotp(id: string): Promise<UserModel> {
    this.logger.log(`Disabling TOTP for user: ${id}`);
    await this.findOne(id);

    await (this.prisma as any).totpRecoveryCode.deleteMany({ where: { userId: id } });

    return this.prisma.user.update({
      where: { id },
      data: { totpEnabled: false, totpSecret: null },
    });
  }

  // ─── TOTP renew recovery codes ─────────────────────────────────────────────

  async renewRecoveryCodes(id: string): Promise<{ user: UserModel; recoveryCodes: string[] }> {
    this.logger.log(`Renewing TOTP recovery codes for user: ${id}`);
    const user = await this.findOne(id);

    if (!user.totpEnabled) {
      throw new BadRequestException('Le TOTP n\'est pas activé pour ce compte');
    }

    const codes = Array.from({ length: 10 }, generateRecoveryCode);
    const hashes = codes.map(hashRecoveryCode);
    const prismaAny = this.prisma as any;

    await prismaAny.totpRecoveryCode.deleteMany({ where: { userId: id } });
    await prismaAny.totpRecoveryCode.createMany({
      data: hashes.map((codeHash: string) => ({ userId: id, codeHash })),
    });

    this.logger.log(`TOTP recovery codes renewed for user: ${id}`);
    return { user, recoveryCodes: codes };
  }

  // ─── Valider et consommer un code de récupération TOTP ────────────────────

  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const codeHash = hashRecoveryCode(code);
    const prismaAny = this.prisma as any;

    const entry = await prismaAny.totpRecoveryCode.findFirst({
      where: { userId, codeHash, usedAt: null },
    });

    if (!entry) return false;

    await prismaAny.totpRecoveryCode.update({
      where: { id: entry.id },
      data: { usedAt: new Date() },
    });

    this.logger.log(`Recovery code consumed for user: ${userId}`);
    return true;
  }
}
