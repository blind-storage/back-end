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
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ─── POST /users ───────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Créer un nouvel utilisateur' })
  @ApiCreatedResponse({ type: UserEntity })
  async create(@Body() dto: CreateUserDto): Promise<UserEntity> {
    const user = await this.usersService.create(dto);
    return new UserEntity(user);
  }

  // ─── GET /users ────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Lister tous les utilisateurs' })
  @ApiOkResponse({ type: [UserEntity] })
  async findAll(): Promise<UserEntity[]> {
    const users = await this.usersService.findAll();
    return users.map((u) => new UserEntity(u));
  }

  // ─── GET /users/:id ────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer un utilisateur par ID' })
  @ApiOkResponse({ type: UserEntity })
  @ApiNotFoundResponse({ description: 'Utilisateur introuvable' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserEntity> {
    const user = await this.usersService.findOne(id);
    return new UserEntity(user);
  }

  // ─── PATCH /users/:id ──────────────────────────────────────────────────────

  @Patch(':id')
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

  // ─── DELETE /users/:id ─────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un utilisateur' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Utilisateur introuvable' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.usersService.remove(id);
  }

  // ─── POST /users/:id/totp/enable ──────────────────────────────────────────

  @Post(':id/totp/enable')
  @ApiOperation({ summary: 'Activer le TOTP pour un utilisateur' })
  @ApiOkResponse({ type: UserEntity })
  async enableTotp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('secret') secret: string,
  ): Promise<UserEntity> {
    const user = await this.usersService.enableTotp(id, secret);
    return new UserEntity(user);
  }

  // ─── POST /users/:id/totp/disable ─────────────────────────────────────────

  @Post(':id/totp/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Désactiver le TOTP pour un utilisateur' })
  @ApiOkResponse({ type: UserEntity })
  async disableTotp(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserEntity> {
    const user = await this.usersService.disableTotp(id);
    return new UserEntity(user);
  }
}
