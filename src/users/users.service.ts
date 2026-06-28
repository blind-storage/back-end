import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'crypto';
import { verifySync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { PkiService } from '../pki/pki.service';

function checkTotp(token: string, secret: string): boolean {
  return verifySync({
    token,
    secret,
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
  }).valid;
}
import type { UserModel } from '../generated/prisma/models/User';
import { PrismaService } from '../prisma.service';
import {
  CreateUserDto,
  OidcConnectionDto,
  UpdateUserDto,
} from '@blind-storage/types';

// ─── Helpers pour les codes de récupération ──────────────────────���─────────────

function generateRecoveryCode(): string {
  const hex = randomBytes(8).toString('hex').toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.toUpperCase()).digest('hex');
}

type KeyCertificate = {
  version: 1;
  subject: { userId: string; username: string; email: string };
  keys: { encryption: string; signing: string | null };
  issuedAt: string;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

export function buildLightPkiMaterial(user: {
  id: string;
  username: string;
  email: string;
  pub_key: string;
  sign_pub_key?: string | null;
}): {
  key_certificate: KeyCertificate;
  key_certificate_signature: string;
  key_fingerprint: string;
} {
  const key_certificate: KeyCertificate = {
    version: 1,
    subject: { userId: user.id, username: user.username, email: user.email },
    keys: { encryption: user.pub_key, signing: user.sign_pub_key ?? null },
    issuedAt: new Date().toISOString(),
  };
  const key_fingerprint = createHash('sha256')
    .update(`${user.pub_key}.${user.sign_pub_key ?? ''}`)
    .digest('base64');
  const secret =
    process.env.PKI_CA_SECRET ??
    process.env.JWT_SECRET ??
    'blind-storage-dev-pki-secret';
  const key_certificate_signature = createHmac('sha256', secret)
    .update(stableJson(key_certificate))
    .digest('base64');
  return { key_certificate, key_certificate_signature, key_fingerprint };
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pkiService: PkiService,
  ) {}

  // ─── Create ─────────────────────────��──────────────────────────────────────

  async create(dto: CreateUserDto): Promise<UserModel> {
    this.logger.log(`Creating user: ${dto.email}`);

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { username: dto.username }] },
    });

    if (existing) {
      const field = existing.email === dto.email ? 'email' : 'username';
      this.logger.warn(
        `Conflict on field "${field}" for value "${dto[field as keyof typeof dto]}"`,
      );
      throw new ConflictException(
        `Un utilisateur avec cet ${field} existe déjà.`,
      );
    }

    try {
      const created = await this.prisma.user.create({ data: dto as any });

      let pkiData: Record<string, unknown>;
      if (this.pkiService.isConfigured()) {
        const { cert, signature, fingerprint } =
          this.pkiService.issueCertificate({
            id: created.id,
            username: created.username,
            email: created.email,
            pub_key: (created as any).pub_key,
          });
        pkiData = {
          key_certificate: cert,
          key_certificate_signature: signature,
          key_fingerprint: fingerprint,
        };
      } else {
        pkiData = buildLightPkiMaterial(created);
      }

      const user = await this.prisma.user.update({
        where: { id: created.id },
        data: pkiData as any,
      });
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

  async lookup(query: string): Promise<UserModel> {
    const q = (query ?? '').trim();
    if (!q) throw new BadRequestException('Recherche utilisateur requise');

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: q }, { username: q }] },
    });
    if (!user) throw new NotFoundException(`Utilisateur introuvable (${q})`);
    return user;
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
        throw new ConflictException(
          `Un utilisateur avec cet ${field} existe déjà.`,
        );
      }
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data: dto as any,
      });
      this.logger.log(`User updated: ${id}`);
      return updated;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to update user ${id}: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  async remove(id: string): Promise<void> {
    this.logger.log(`Deleting user: ${id}`);
    const user = await this.findOne(id);

    const fingerprint = (user as any).key_fingerprint as string | null;
    if (fingerprint && this.pkiService.isConfigured()) {
      await this.pkiService.revokeCertificate(fingerprint, 'account_deleted');
    }

    try {
      const ownedFiles = await this.prisma.file.findMany({
        where: { ownerId: id },
        select: { id: true },
      });
      const ownedFileIds = ownedFiles.map((file) => file.id);

      await this.prisma.$transaction([
        this.prisma.filePermission.deleteMany({
          where: {
            OR: [
              ...(ownedFileIds.length
                ? [{ fileId: { in: ownedFileIds } }]
                : []),
              { userId: id },
              { grantedById: id },
            ],
          },
        }),
        this.prisma.fileVersion.deleteMany({
          where: {
            OR: [
              ...(ownedFileIds.length
                ? [{ fileId: { in: ownedFileIds } }]
                : []),
              { editedById: id },
            ],
          },
        }),
        this.prisma.file.deleteMany({ where: { ownerId: id } }),
        this.prisma.userTree.deleteMany({ where: { userId: id } }),
        this.prisma.user.delete({ where: { id } }),
      ]);
      this.logger.log(`User deleted: ${id}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to delete user ${id}: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  // ─── Count remaining recovery codes ───────────────────────────────────────

  countRemainingRecoveryCodes(userId: string): Promise<number> {
    return (this.prisma as any).totpRecoveryCode.count({
      where: { userId, usedAt: null },
    });
  }

  // ─── TOTP enable (génère les codes de récupération) ────────────────────────

  async enableTotp(
    id: string,
    secret: string,
    code: string,
  ): Promise<{ user: UserModel; recoveryCodes: string[] }> {
    this.logger.log(`Enabling TOTP for user: ${id}`);
    await this.findOne(id);

    if (!checkTotp(code, secret)) {
      this.logger.warn(`Invalid TOTP verification code for user: ${id}`);
      throw new UnauthorizedException(
        'Code TOTP invalide — vérifiez que votre application est bien configurée',
      );
    }

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

    await (this.prisma as any).totpRecoveryCode.deleteMany({
      where: { userId: id },
    });

    return this.prisma.user.update({
      where: { id },
      data: { totpEnabled: false, totpSecret: null },
    });
  }

  // ─── TOTP renew recovery codes ─────────────────────────────────────────────

  async renewRecoveryCodes(
    id: string,
  ): Promise<{ user: UserModel; recoveryCodes: string[] }> {
    this.logger.log(`Renewing TOTP recovery codes for user: ${id}`);
    const user = await this.findOne(id);

    if (!user.totpEnabled) {
      throw new BadRequestException("Le TOTP n'est pas activé pour ce compte");
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

  // ─── OIDC connections ──────────────────────────────────────────────────────

  async getOidcConnections(userId: string): Promise<OidcConnectionDto[]> {
    return this.prisma.oidcConnection.findMany({
      where: { userId },
      select: { provider: true, email: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async removeOidcConnection(userId: string, provider: string): Promise<void> {
    const conn = await this.prisma.oidcConnection.findUnique({
      where: { userId_provider: { userId, provider: provider as any } },
    });
    if (!conn)
      throw new NotFoundException(`Aucune connexion ${provider} trouvée`);
    await this.prisma.oidcConnection.delete({ where: { id: conn.id } });
    this.logger.log(`OIDC connection ${provider} removed for user: ${userId}`);
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
