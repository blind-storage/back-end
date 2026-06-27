import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  CreateUserDto,
  EnableTotpResponseDto,
  OidcConnectionDto,
  Role,
  UpdateUserDto,
  UserEntity,
} from '@blind-storage/types';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { SelfOrAdminGuard } from '../auth/guards/self-or-admin/self-or-admin.guard';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ─── POST /users ─────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Créer un utilisateur (inscription)' })
  @ApiCreatedResponse({ type: UserEntity })
  async create(@Body() dto: CreateUserDto): Promise<UserEntity> {
    const user = await this.usersService.create(dto);
    return new UserEntity(user);
  }

  // ─── GET /users ──────────────────────────────── admin only ───────────────

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lister tous les utilisateurs (admin)' })
  @ApiOkResponse({ type: [UserEntity] })
  @ApiUnauthorizedResponse()
  async findAll(): Promise<UserEntity[]> {
    const users = await this.usersService.findAll();
    return users.map((u) => new UserEntity(u));
  }

  // ─── GET /users/:id ─────────────────────────── authentifié ──────────────

  @Get(':id')
  @UseGuards(JwtAuthGuard, SelfOrAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Récupérer un utilisateur par ID' })
  @ApiOkResponse({ type: UserEntity })
  @ApiNotFoundResponse({ description: 'Utilisateur introuvable' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserEntity> {
    const [user, remaining] = await Promise.all([
      this.usersService.findOne(id),
      this.usersService.countRemainingRecoveryCodes(id),
    ]);
    return new UserEntity(user, remaining);
  }

  // ─── PATCH /users/:id ─────────────────────────── self | admin ───────────

  @Patch(':id')
  @UseGuards(JwtAuthGuard, SelfOrAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mettre à jour un utilisateur' })
  @ApiOkResponse({ type: UserEntity })
  @ApiNotFoundResponse({ description: 'Utilisateur introuvable' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserEntity> {
    const user = await this.usersService.update(id, dto);
    return new UserEntity(user);
  }

  // ─── DELETE /users/:id ────────────���───────────── self | admin ───────────

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SelfOrAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un compte (propriétaire ou admin)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Utilisateur introuvable' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.usersService.remove(id);
  }

  // ─── GET /users/:id/oidc-connections ──────────── self | admin ───────────

  @Get(':id/oidc-connections')
  @UseGuards(JwtAuthGuard, SelfOrAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lister les providers OIDC liés au compte' })
  @ApiOkResponse({ description: 'Liste des connexions OIDC' })
  async getOidcConnections(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OidcConnectionDto[]> {
    return this.usersService.getOidcConnections(id);
  }

  // ─── DELETE /users/:id/oidc-connections/:provider ─── self | admin ───────

  @Delete(':id/oidc-connections/:provider')
  @UseGuards(JwtAuthGuard, SelfOrAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Délier un provider OIDC du compte' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Connexion introuvable' })
  async removeOidcConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('provider') provider: string,
  ): Promise<void> {
    return this.usersService.removeOidcConnection(id, provider);
  }

  // ─── POST /users/:id/totp/enable ─────────────── self | admin ───────────

  @Post(':id/totp/enable')
  @UseGuards(JwtAuthGuard, SelfOrAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Activer le TOTP — retourne les codes de récupération (affichés une seule fois)',
  })
  @ApiCreatedResponse({ type: EnableTotpResponseDto })
  async enableTotp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('secret') secret: string,
    @Body('code') code: string,
  ): Promise<EnableTotpResponseDto> {
    const { user, recoveryCodes } = await this.usersService.enableTotp(
      id,
      secret,
      code,
    );
    return { user: new UserEntity(user), recovery_codes: recoveryCodes };
  }

  // ─── POST /users/:id/totp/renew-codes ───────────── self | admin ─────────

  @Post(':id/totp/renew-codes')
  @UseGuards(JwtAuthGuard, SelfOrAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renouveler les codes de récupération TOTP (invalide les anciens)',
  })
  @ApiOkResponse({ type: EnableTotpResponseDto })
  async renewRecoveryCodes(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EnableTotpResponseDto> {
    const { user, recoveryCodes } =
      await this.usersService.renewRecoveryCodes(id);
    return { user: new UserEntity(user), recovery_codes: recoveryCodes };
  }

  // ─── POST /users/:id/totp/disable ────────────── self | admin ───────────

  @Post(':id/totp/disable')
  @UseGuards(JwtAuthGuard, SelfOrAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Désactiver le TOTP (propriétaire ou admin)' })
  @ApiOkResponse({ type: UserEntity })
  async disableTotp(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserEntity> {
    const user = await this.usersService.disableTotp(id);
    return new UserEntity(user);
  }
}
