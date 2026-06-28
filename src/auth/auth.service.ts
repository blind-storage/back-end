import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual, randomBytes, publicEncrypt, constants, createPublicKey } from 'crypto';
import { verifySync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';

function checkTotp(token: string, secret: string): boolean {
  return verifySync({ token, secret, crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() }).valid;
}
import {
  AuthResponseDto,
  OidcLinkPendingResponseDto,
  OidcPendingResponseDto,
  OidcProvider,
  OidcSetupDto,
  Role,
  TotpRequiredResponseDto,
} from '@blind-storage/types';
import type {
  JwtPayload,
  OidcLinkTotpPendingPayload,
  OidcNoncePayload,
  OidcPendingPayload,
  PendingLinkPayload,
  PendingLinkProfile,
  PendingOidcProfile,
  PendingSetupPayload,
  TotpPendingPayload,
} from '@blind-storage/types';
import type { UserModel } from '../generated/prisma/models/User';
import { PrismaService } from '../prisma.service';
import { UsersService, buildLightPkiMaterial, hashRecoveryCode } from '../users/users.service';

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

  login(user: UserModel): AuthResponseDto | TotpRequiredResponseDto {
    if (user.totpEnabled) {
      this.logger.log(`TOTP required for user: ${user.id}`);
      const payload: TotpPendingPayload = { totpPending: true, sub: user.id };
      const totp_token = this.jwtService.sign(payload, { expiresIn: '5m' });
      return { totp_required: true, totp_token };
    }
    return this.issueToken(user);
  }

  issueToken(user: UserModel): AuthResponseDto {
    this.logger.log(`Issuing JWT for user: ${user.id}`);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: ((user as any).role as Role) ?? Role.USER,
    };
    return { access_token: this.jwtService.sign(payload) };
  }

  async verifyTotpLogin(totpToken: string, code: string): Promise<AuthResponseDto> {
    let payload: TotpPendingPayload;
    try {
      payload = this.jwtService.verify<TotpPendingPayload>(totpToken);
    } catch {
      throw new UnauthorizedException('Token TOTP invalide ou expiré');
    }

    if (!payload.totpPending) throw new UnauthorizedException('Token invalide');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.totpEnabled || !user.totpSecret) {
      throw new UnauthorizedException('Compte introuvable ou TOTP désactivé');
    }

    const isValid = checkTotp(code, user.totpSecret);
    if (!isValid) {
      this.logger.warn(`Invalid TOTP code for user: ${user.id}`);
      throw new UnauthorizedException('Code TOTP incorrect');
    }

    this.logger.log(`TOTP verified for user: ${user.id}`);
    return this.issueToken(user);
  }

  // OIDC auth

  handleOidcCallback(user: OidcCallbackUser): AuthResponseDto | OidcPendingResponseDto | OidcLinkPendingResponseDto {
    if (isPendingSetup(user)) return this.generatePendingResponse(user);
    if (isPendingLink(user))  return this.generatePendingLinkResponse(user);
    return this.issuePendingLoginToken(user);
  }

  private issuePendingLoginToken(user: UserModel): AuthResponseDto {
    this.logger.log(`Issuing OIDC pending login token for user: ${user.id}`);
    const payload: OidcPendingPayload = { oidcPending: true, sub: user.id, username: user.username };
    return { access_token: this.jwtService.sign(payload, { expiresIn: '10m' }) };
  }

  async createOidcChallenge(pendingToken: string): Promise<{ nonce_token: string; encrypted_challenge: string; priv_key_enc_1: string }> {
    let payload: OidcPendingPayload;
    try {
      payload = this.jwtService.verify<OidcPendingPayload>(pendingToken);
    } catch {
      throw new UnauthorizedException('Token OIDC invalide ou expiré');
    }
    if (!payload.oidcPending) throw new UnauthorizedException('Token invalide');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.priv_key_enc_1) throw new UnauthorizedException('Utilisateur introuvable');

    const challenge = randomBytes(32);
    const pubKeyObject = createPublicKey({ key: Buffer.from(user.pub_key, 'base64'), format: 'der', type: 'spki' });
    const encrypted = publicEncrypt(
      { key: pubKeyObject, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      challenge,
    );

    const noncePayload: OidcNoncePayload = { oidcNonce: true, sub: user.id, nonce: challenge.toString('base64') };
    const nonce_token = this.jwtService.sign(noncePayload, { expiresIn: '5m' });

    return { nonce_token, encrypted_challenge: encrypted.toString('base64'), priv_key_enc_1: user.priv_key_enc_1 };
  }

  async verifyOidcChallenge(nonce_token: string, plaintext: string): Promise<AuthResponseDto | TotpRequiredResponseDto> {
    let noncePayload: OidcNoncePayload;
    try {
      noncePayload = this.jwtService.verify<OidcNoncePayload>(nonce_token);
    } catch {
      throw new UnauthorizedException('Token de défi invalide ou expiré');
    }
    if (!noncePayload.oidcNonce) throw new UnauthorizedException('Token invalide');

    const expected = Buffer.from(noncePayload.nonce, 'base64');
    const received = Buffer.from(plaintext, 'base64');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException('Défi RSA incorrect — mot de passe maître invalide');
    }

    const user = await this.prisma.user.findUnique({ where: { id: noncePayload.sub } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');

    if (user.totpEnabled) {
      const totpPayload: TotpPendingPayload = { totpPending: true, sub: user.id };
      const totp_token = this.jwtService.sign(totpPayload, { expiresIn: '5m' });
      return { totp_required: true, totp_token };
    }

    return this.issueToken(user);
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

  async confirmOidcLink(link_token: string, auth_hash: string): Promise<AuthResponseDto | TotpRequiredResponseDto> {
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

    if (user.totpEnabled) {
      const totpPayload: OidcLinkTotpPendingPayload = { totpPending: true, sub: user.id, linkToken: link_token };
      const totp_token = this.jwtService.sign(totpPayload, { expiresIn: '5m' });
      return { totp_required: true, totp_token };
    }

    return this._createOidcLinkAndIssueToken(payload, user);
  }

  async confirmOidcLinkTotp(totp_token: string, code: string): Promise<AuthResponseDto> {
    this.logger.log('Confirming OIDC link TOTP step');

    let totpPayload: OidcLinkTotpPendingPayload;
    try {
      totpPayload = this.jwtService.verify<OidcLinkTotpPendingPayload>(totp_token);
    } catch {
      throw new UnauthorizedException('Token TOTP invalide ou expiré');
    }

    if (!totpPayload.totpPending || !totpPayload.linkToken) throw new UnauthorizedException('Token invalide');

    const user = await this.prisma.user.findUnique({ where: { id: totpPayload.sub } });
    if (!user || !user.totpEnabled || !user.totpSecret) {
      throw new UnauthorizedException('Compte introuvable ou TOTP désactivé');
    }

    if (!checkTotp(code, user.totpSecret)) {
      throw new UnauthorizedException('Code TOTP incorrect');
    }

    let linkPayload: PendingLinkPayload;
    try {
      linkPayload = this.jwtService.verify<PendingLinkPayload>(totpPayload.linkToken);
    } catch {
      throw new UnauthorizedException('Token de liaison expiré, recommencez le flux OIDC');
    }

    return this._createOidcLinkAndIssueToken(linkPayload, user);
  }

  private async _createOidcLinkAndIssueToken(payload: PendingLinkPayload, user: UserModel): Promise<AuthResponseDto> {
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
    return this.issueToken(user);
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
          sign_pub_key: dto.sign_pub_key,
          sign_priv_key_enc_1: dto.sign_priv_key_enc_1,
          sign_priv_key_enc_2: dto.sign_priv_key_enc_2,
          salt_mp: dto.salt_mp,
          salt_rc: dto.salt_rc,
          tree_enc_key: dto.tree_enc_key,
        } as any,
      });

      const pkiUser = await tx.user.update({
        where: { id: newUser.id },
        data: buildLightPkiMaterial(newUser) as any,
      });

      await tx.oidcConnection.create({
        data: {
          userId: pkiUser.id,
          provider: payload.provider as OidcProvider,
          providerUserId: payload.providerUserId,
          email: payload.email,
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
        },
      });

      return pkiUser as UserModel;
    });

    this.logger.log(`OIDC first-time setup completed for user: ${user.id}`);
    return this.issueToken(user);
  }

  // Change password

  async changePassword(
    userId: string,
    dto: { auth_hash: string; priv_key_enc_1: string; salt_mp: string; sign_priv_key_enc_1?: string },
  ): Promise<void> {
    this.logger.log(`Changing master password for user: ${userId}`);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        auth_hash: dto.auth_hash,
        priv_key_enc_1: dto.priv_key_enc_1,
        sign_priv_key_enc_1: dto.sign_priv_key_enc_1,
        salt_mp: dto.salt_mp,
      },
    });

    this.logger.log(`Master password changed for user: ${userId}`);
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
    return this.issueToken(updatedUser);
  }
}
