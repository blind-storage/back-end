import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthResponseDto,
  LoginDto,
  OidcLinkPendingResponseDto,
  OidcPendingResponseDto,
  OidcSetupDto,
  TotpRecoverDto,
  TotpRequiredResponseDto,
  TotpVerifyDto,
} from '@blind-storage/types';
import type { JwtUser } from '@blind-storage/types';
import { AuthService } from './auth.service';
import { DropboxAuthGuard } from './guards/dropbox-auth/dropbox-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth/jwt-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth/local-auth.guard';
import { RezelAuthGuard } from './guards/rezel-auth/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private redirectOidcResult(
    res: Response,
    result: AuthResponseDto | OidcPendingResponseDto | OidcLinkPendingResponseDto,
  ): void {
    const base = process.env.FRONTEND_URL ?? 'http://localhost:8000';
    let url: string;
    if ('access_token' in result) {
      url = `${base}/callback?token=${encodeURIComponent(result.access_token)}`;
    } else if ('setup_required' in result) {
      url = `${base}/callback?setup_token=${encodeURIComponent(result.setup_token)}&email=${encodeURIComponent(result.email)}`;
    } else {
      url = `${base}/callback?link_token=${encodeURIComponent(result.link_token)}&email=${encodeURIComponent(result.email)}`;
    }
    res.redirect(url);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @ApiOperation({ summary: 'Connexion avec username et mot de passe' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ description: 'JWT ou défi TOTP si activé' })
  @ApiUnauthorizedResponse({ description: 'Identifiants invalides' })
  login(@Request() req: any): AuthResponseDto | TotpRequiredResponseDto {
    return this.authService.login(req.user);
  }

  // ─── POST /auth/totp/verify ────────────────────────────────────────────────

  @Post('totp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifier le code TOTP après login (second facteur)' })
  @ApiBody({ type: TotpVerifyDto })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Code TOTP invalide ou token expiré' })
  async totpVerify(@Body() dto: TotpVerifyDto): Promise<AuthResponseDto> {
    return this.authService.verifyTotpLogin(dto.totp_token, dto.code);
  }

  // ─── GET /auth/profile ─────────────────────────────────────────────────────

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Profil de l'utilisateur courant (payload JWT)" })
  @ApiOkResponse({ description: 'Identité décodée depuis le JWT' })
  profile(@Request() req: any): JwtUser {
    return req.user;
  }

  // ─── POST /auth/change-password ────────────────────────────────────────────

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Changer le mot de passe maître (la clé privée est re-chiffrée côté client)' })
  @ApiBody({
    schema: {
      properties: {
        auth_hash:      { type: 'string', description: 'Nouveau hash du mot de passe maître (dérivé côté client)' },
        priv_key_enc_1: { type: 'string', description: 'Clé privée re-chiffrée avec la nouvelle KEK' },
        sign_priv_key_enc_1: { type: 'string', description: 'Clé privée de signature re-chiffrée avec la nouvelle KEK', nullable: true },
        salt_mp:        { type: 'string', description: 'Nouveau salt pour la dérivation du mot de passe maître' },
      },
      required: ['auth_hash', 'priv_key_enc_1', 'salt_mp'],
    },
  })
  @ApiNoContentResponse({ description: 'Mot de passe maître mis à jour' })
  @ApiUnauthorizedResponse({ description: 'Token invalide ou expiré' })
  async changePassword(
    @Request() req: any,
    @Body() dto: { auth_hash: string; priv_key_enc_1: string; salt_mp: string; sign_priv_key_enc_1?: string },
  ): Promise<void> {
    return this.authService.changePassword(req.user.id, dto);
  }

  // ─── GET /auth/google ──────────────────────────────────────────────────────

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Redirection vers Google OAuth2' })
  googleLogin(): void {}

  // ─── GET /auth/google/callback ─────────────────────────────────────────────

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Callback Google OAuth2' })
  googleCallback(@Request() req: any, @Res() res: Response): void {
    this.redirectOidcResult(res, this.authService.handleOidcCallback(req.user));
  }

  // ─── GET /auth/rezel ───────────────────────────────────────────────────────

  @Get('rezel')
  @UseGuards(RezelAuthGuard)
  @ApiOperation({ summary: 'Redirection vers Rezel OIDC' })
  rezelLogin(): void {}

  // ─── GET /auth/rezel/callback ──────────────────────────────────────────────

  @Get('rezel/callback')
  @UseGuards(RezelAuthGuard)
  @ApiOperation({ summary: 'Callback Rezel OIDC' })
  rezelCallback(@Request() req: any, @Res() res: Response): void {
    this.redirectOidcResult(res, this.authService.handleOidcCallback(req.user));
  }

  // ─── GET /auth/dropbox ─────────────────────────────────────────────────────

  @Get('dropbox')
  @UseGuards(DropboxAuthGuard)
  @ApiOperation({ summary: 'Redirection vers Dropbox OAuth2' })
  dropboxLogin(): void {}

  // ─── GET /auth/dropbox/callback ────────────────────────────────────────────

  @Get('dropbox/callback')
  @UseGuards(DropboxAuthGuard)
  @ApiOperation({ summary: 'Callback Dropbox OAuth2' })
  dropboxCallback(@Request() req: any, @Res() res: Response): void {
    this.redirectOidcResult(res, this.authService.handleOidcCallback(req.user));
  }

  // ─── POST /auth/oidc/challenge ─────────────────────────────────────────────

  @Post('oidc/challenge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtenir un défi RSA-OAEP à déchiffrer avec la clé privée' })
  @ApiBody({ schema: { properties: { pending_token: { type: 'string' } }, required: ['pending_token'] } })
  @ApiOkResponse({ description: '{ nonce_token, encrypted_challenge, priv_key_enc_1 }' })
  @ApiUnauthorizedResponse({ description: 'Token pending invalide ou expiré' })
  async oidcChallenge(
    @Body('pending_token') pending_token: string,
  ): Promise<{ nonce_token: string; encrypted_challenge: string; priv_key_enc_1: string }> {
    return this.authService.createOidcChallenge(pending_token);
  }

  // ─── POST /auth/oidc/verify ────────────────────────────────────────────────

  @Post('oidc/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifier la réponse au défi RSA-OAEP et obtenir un JWT complet' })
  @ApiBody({
    schema: {
      properties: {
        nonce_token: { type: 'string' },
        plaintext:   { type: 'string', description: 'base64 du nonce déchiffré avec la clé privée' },
      },
      required: ['nonce_token', 'plaintext'],
    },
  })
  @ApiOkResponse({ type: AuthResponseDto, description: 'JWT complet ou défi TOTP si 2FA activé' })
  @ApiUnauthorizedResponse({ description: 'Défi incorrect ou token expiré' })
  async oidcVerify(
    @Body('nonce_token') nonce_token: string,
    @Body('plaintext') plaintext: string,
  ): Promise<AuthResponseDto | TotpRequiredResponseDto> {
    return this.authService.verifyOidcChallenge(nonce_token, plaintext);
  }

  // ─── POST /auth/oidc/setup ─────────────────────────────────────────────────

  @Post('oidc/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finaliser la configuration après première connexion OIDC' })
  @ApiBody({ type: OidcSetupDto })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Token de configuration invalide ou expiré' })
  async oidcSetup(@Body() dto: OidcSetupDto): Promise<AuthResponseDto> {
    return this.authService.completeOidcSetup(dto);
  }

  // ─── POST /auth/oidc/link-confirm ──────────────────────────────────────────

  @Post('oidc/link-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmer le lien OIDC avec le mot de passe maître' })
  @ApiBody({
    schema: {
      properties: {
        link_token: { type: 'string' },
        auth_hash:  { type: 'string' },
      },
      required: ['link_token', 'auth_hash'],
    },
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Token invalide ou mot de passe incorrect' })
  async confirmOidcLink(
    @Body('link_token') link_token: string,
    @Body('auth_hash') auth_hash: string,
  ): Promise<AuthResponseDto | TotpRequiredResponseDto> {
    return this.authService.confirmOidcLink(link_token, auth_hash);
  }

  // ─── POST /auth/oidc/link-confirm-totp ────────────────────────────────────

  @Post('oidc/link-confirm-totp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifier le TOTP pour finaliser la liaison OIDC' })
  @ApiBody({ schema: { properties: { totp_token: { type: 'string' }, code: { type: 'string' } }, required: ['totp_token', 'code'] } })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Code TOTP invalide ou token expiré' })
  async confirmOidcLinkTotp(
    @Body('totp_token') totp_token: string,
    @Body('code') code: string,
  ): Promise<AuthResponseDto> {
    return this.authService.confirmOidcLinkTotp(totp_token, code);
  }

  // ─── POST /auth/oidc/link ──────────────────────────────────────────────────

  @Post('oidc/link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lier un provider OIDC (Google, Rezel) à un compte déjà authentifié — accepte un setup_token ou un link_token' })
  @ApiBody({ schema: { properties: { token: { type: 'string', description: 'setup_token ou link_token reçu après le callback OAuth' } }, required: ['token'] } })
  @ApiNoContentResponse({ description: 'Provider OIDC lié avec succès' })
  async linkOidcProvider(@Request() req: any, @Body('token') token: string): Promise<void> {
    return this.authService.linkOidcProvider(req.user.id, token);
  }

  // ─── POST /auth/totp/recover ───────────────────────────────────────────────

  @Post('totp/recover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Récupérer l'accès via un code de récupération TOTP (désactive le TOTP)" })
  @ApiBody({ type: TotpRecoverDto })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Identifiants ou code de récupération invalide' })
  async totpRecover(@Body() dto: TotpRecoverDto): Promise<AuthResponseDto> {
    return this.authService.recoverWithCode(dto.username, dto.password, dto.recovery_code);
  }
}
