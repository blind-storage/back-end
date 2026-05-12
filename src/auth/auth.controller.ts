import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { OidcLinkPendingResponseDto } from './dto/oidc-link-pending-response.dto';
import { OidcPendingResponseDto } from './dto/oidc-pending-response.dto';
import { OidcSetupDto } from './dto/oidc-setup.dto';
import { TotpRecoverDto } from './dto/totp-recover.dto';
import { DropboxAuthGuard } from './guards/dropbox-auth/dropbox-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth/jwt-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth/local-auth.guard';
import { RezelAuthGuard } from './guards/rezel-auth/jwt-auth.guard';
import type { JwtUser } from './strategies/jwt.strategy/jwt.strategy';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @ApiOperation({ summary: 'Connexion avec username et mot de passe' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Identifiants invalides' })
  login(@Request() req: any): AuthResponseDto {
    return this.authService.login(req.user);
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

  // ─── GET /auth/google ──────────────────────────────────────────────────────

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Redirection vers Google OAuth2' })
  googleLogin(): void {}

  // ─── GET /auth/google/callback ─────────────────────────────────────────────

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Callback Google OAuth2' })
  @ApiOkResponse({ description: 'JWT, pending setup ou pending link selon le cas' })
  googleCallback(@Request() req: any): AuthResponseDto | OidcPendingResponseDto | OidcLinkPendingResponseDto {
    return this.authService.handleOidcCallback(req.user);
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
  @ApiOkResponse({ description: 'JWT, pending setup ou pending link selon le cas' })
  rezelCallback(@Request() req: any): AuthResponseDto | OidcPendingResponseDto | OidcLinkPendingResponseDto {
    return this.authService.handleOidcCallback(req.user);
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
  @ApiOkResponse({ description: 'JWT, pending setup ou pending link selon le cas' })
  dropboxCallback(@Request() req: any): AuthResponseDto | OidcPendingResponseDto | OidcLinkPendingResponseDto {
    return this.authService.handleOidcCallback(req.user);
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
  ): Promise<AuthResponseDto> {
    return this.authService.confirmOidcLink(link_token, auth_hash);
  }

  // ─── POST /auth/oidc/link ──────────────────────────────────────────────────

  @Post('oidc/link')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lier un provider OIDC (Google, Rezel) à un compte déjà authentifié — accepte un setup_token ou un link_token' })
  @ApiBody({ schema: { properties: { token: { type: 'string', description: 'setup_token ou link_token reçu après le callback OAuth' } }, required: ['token'] } })
  @ApiOkResponse({ description: 'Provider OIDC lié avec succès' })
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
