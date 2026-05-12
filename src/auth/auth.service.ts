import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'crypto';
import { OidcProvider, Role } from '../generated/prisma/enums';
import type { UserModel } from '../generated/prisma/models/User';
import { PrismaService } from '../prisma.service';
import { UsersService, hashRecoveryCode } from '../users/users.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { OidcLinkPendingResponseDto } from './dto/oidc-link-pending-response.dto';
import { OidcPendingResponseDto } from './dto/oidc-pending-response.dto';
import { OidcSetupDto } from './dto/oidc-setup.dto';
import type {
  JwtPayload,
  PendingLinkPayload,
  PendingSetupPayload,
} from './strategies/jwt.strategy/jwt.strategy';

export interface PendingOidcProfile {
  pendingSetup: true;
  provider: OidcProvider;
  providerUserId: string;
  email: string;
  accessToken: string;
  refreshToken: string | null;
}

export interface PendingLinkProfile {
  pendingLink: true;
  userId: string;
  provider: OidcProvider;
  providerUserId: string;
  email: string;
  accessToken: string;
  refreshToken: string | null;
}

type OidcCallbackUser = UserModel | PendingOidcProfile | PendingLinkProfile;

function isPendingSetup(user: OidcCallbackUser): user is PendingOidcProfile {
  return (user as PendingOidcProfile).pendingSetup === true;
}

function isPendingLink(user: OidcCallbackUser): user is PendingLinkProfile {
  return (user as PendingLinkProfile).pendingLink === true;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  // Local auth

  async validateUser(username: string, password: string): Promise<UserModel | null> {
    this.logger.log(`Validating credentials for: ${username}`);
    const user = await this.usersService.findByUsername(username);

    if (!user || !user.auth_hash) {
      this.logger.warn(`Login failed: user not found or no password set (${username})`);
      return null;
    }

    const a = Buffer.from(password);
    const b = Buffer.from(user.auth_hash);
    const isMatch = a.length === b.length && timingSafeEqual(a, b);
    if (!isMatch) {
      this.logger.warn(`Login failed: wrong password for user ${user.id}`);
      return null;
    }

    this.logger.log(`Credentials valid for user: ${user.id}`);
    return user;
  }

  login(user: UserModel): AuthResponseDto {
    this.logger.log(`Issuing JWT for user: ${user.id}`);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: ((user as any).role as Role) ?? Role.USER,
    };
    return { access_token: this.jwtService.sign(payload) };
  }

  // OIDC auth

  handleOidcCallback(user: OidcCallbackUser): AuthResponseDto | OidcPendingResponseDto | OidcLinkPendingResponseDto {
    if (isPendingSetup(user)) return this.generatePendingResponse(user);
    if (isPendingLink(user))  return this.generatePendingLinkResponse(user);
    return this.login(user);
  }

  generatePendingLinkResponse(profile: PendingLinkProfile): OidcLinkPendingResponseDto {
    this.logger.log(`Generating pending link token for provider: ${profile.provider}`);
    const payload: PendingLinkPayload = {
      pendingLink: true,
      userId: profile.userId,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
      accessToken: profile.accessToken,
      refreshToken: profile.refreshToken,
    };
    const link_token = this.jwtService.sign(payload, { expiresIn: '15m' });
    return { link_required: true, link_token, email: profile.email };
  }

  async confirmOidcLink(link_token: string, auth_hash: string): Promise<AuthResponseDto> {
    this.logger.log('Confirming OIDC link with master password');

    let payload: PendingLinkPayload;
    try {
      payload = this.jwtService.verify<PendingLinkPayload>(link_token);
    } catch {
      throw new UnauthorizedException('Token de liaison invalide ou expiré');
    }

    if (!payload.pendingLink) throw new UnauthorizedException('Token invalide');

    const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');

    const a = Buffer.from(auth_hash);
    const b = Buffer.from(user.auth_hash ?? '');
    const isMatch = a.length === b.length && timingSafeEqual(a, b);
    if (!isMatch) throw new UnauthorizedException('Mot de passe maître incorrect');

    const existing = await this.prisma.oidcConnection.findUnique({
      where: {
        provider_providerUserId: {
          provider: payload.provider as OidcProvider,
          providerUserId: payload.providerUserId,
        },
      },
    });
    if (existing) throw new ConflictException('Ce compte OIDC est déjà lié à un utilisateur');

    await this.prisma.oidcConnection.create({
      data: {
        userId: user.id,
        provider: payload.provider as OidcProvider,
        providerUserId: payload.providerUserId,
        email: payload.email,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
      },
    });

    this.logger.log(`OIDC provider ${payload.provider} linked to user: ${user.id}`);
    return this.login(user);
  }

  generatePendingResponse(profile: PendingOidcProfile): OidcPendingResponseDto {
    this.logger.log(`Generating pending setup token for provider: ${profile.provider}`);
    const payload: PendingSetupPayload = {
      pending: true,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
      accessToken: profile.accessToken,
      refreshToken: profile.refreshToken,
    };
    const setup_token = this.jwtService.sign(payload, { expiresIn: '15m' });
    return { setup_required: true, setup_token, email: profile.email };
  }

  async completeOidcSetup(dto: OidcSetupDto): Promise<AuthResponseDto> {
    this.logger.log('Completing OIDC first-time setup');

    let payload: PendingSetupPayload;
    try {
      payload = this.jwtService.verify<PendingSetupPayload>(dto.setup_token);
    } catch {
      throw new UnauthorizedException('Token de configuration invalide ou expiré');
    }

    if (!payload.pending) {
      throw new UnauthorizedException('Token invalide');
    }

    const existing = await this.prisma.oidcConnection.findUnique({
      where: {
        provider_providerUserId: {
          provider: payload.provider as OidcProvider,
          providerUserId: payload.providerUserId,
        },
      },
    });
    if (existing) {
      throw new ConflictException('Un compte est déjà associé à ce fournisseur OIDC');
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: payload.email,
          username: dto.username,
          auth_hash: dto.auth_hash,
          pub_key: dto.pub_key,
          priv_key_enc_1: dto.priv_key_enc_1,
          priv_key_enc_2: dto.priv_key_enc_2,
          salt_mp: dto.salt_mp,
          salt_rc: dto.salt_rc,
          tree_enc_key: dto.tree_enc_key,
        } as any,
      });

      await tx.oidcConnection.create({
        data: {
          userId: newUser.id,
          provider: payload.provider as OidcProvider,
          providerUserId: payload.providerUserId,
          email: payload.email,
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
        },
      });

      return newUser as UserModel;
    });

    this.logger.log(`OIDC first-time setup completed for user: ${user.id}`);
    return this.login(user);
  }

  // Change password

  async changePassword(
    userId: string,
    dto: { auth_hash: string; priv_key_enc_1: string; salt_mp: string },
  ): Promise<void> {
    // TO BE DONE : Encrypt all files with the new key
  }

  // Link OIDC provider

  async linkOidcProvider(userId: string, token: string): Promise<void> {
    this.logger.log(`Linking OIDC provider to user: ${userId}`);

    let decoded: PendingSetupPayload | PendingLinkPayload;
    try {
      decoded = this.jwtService.verify<PendingSetupPayload | PendingLinkPayload>(token);
    } catch {
      throw new UnauthorizedException('Token invalide ou expiré');
    }

    if (!('pending' in decoded) && !('pendingLink' in decoded)) {
      throw new UnauthorizedException('Token invalide');
    }

    if ('pendingLink' in decoded && decoded.userId !== userId) {
      throw new UnauthorizedException('Ce token de liaison ne correspond pas à votre compte');
    }

    const { provider, providerUserId, email, accessToken, refreshToken } = decoded;

    const existing = await this.prisma.oidcConnection.findUnique({
      where: { provider_providerUserId: { provider: provider as OidcProvider, providerUserId } },
    });
    if (existing) {
      throw new ConflictException('Ce compte OIDC est déjà lié à un utilisateur');
    }

    await this.prisma.oidcConnection.create({
      data: {
        userId,
        provider: provider as OidcProvider,
        providerUserId,
        email,
        accessToken,
        refreshToken,
      },
    });

    this.logger.log(`OIDC provider ${provider} linked to user: ${userId}`);
  }

  // ─── TOTP recovery ─────────────���─────────────────────────────��─────────────

  async recoverWithCode(username: string, password: string, recoveryCode: string): Promise<AuthResponseDto> {
    this.logger.log(`TOTP recovery attempt for: ${username}`);

    const user = await this.validateUser(username, password);
    if (!user) throw new UnauthorizedException('Identifiants incorrects');

    if (!user.totpEnabled) {
      throw new BadRequestException('Le TOTP n\'est pas activé pour ce compte');
    }

    const codeHash = hashRecoveryCode(recoveryCode);
    const prismaAny = this.prisma as any;

    const entry = await prismaAny.totpRecoveryCode.findFirst({
      where: { userId: user.id, codeHash, usedAt: null },
    });

    if (!entry) {
      this.logger.warn(`Invalid recovery code for user: ${user.id}`);
      throw new UnauthorizedException('Code de récupération invalide ou déjà utilisé');
    }

    await prismaAny.totpRecoveryCode.update({
      where: { id: entry.id },
      data: { usedAt: new Date() },
    });

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null },
    });

    this.logger.log(`TOTP recovery successful for user: ${user.id}`);
    return this.login(updatedUser);
  }
}
