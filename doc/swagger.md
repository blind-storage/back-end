# Swagger — Documentation API NestJS

## Sommaire

- [Installation](#installation)
- [Configuration dans main.ts](#configuration-dans-maints)
- [Décorer les contrôleurs](#décorer-les-contrôleurs)
- [Décorer les DTOs](#décorer-les-dtos)
- [Authentification JWT](#authentification-jwt)
- [Grouper les routes avec des tags](#grouper-les-routes-avec-des-tags)
- [Réponses typées](#réponses-typées)
- [Types avancés](#types-avancés)
- [Accès à l'interface](#accès-à-linterface)

---

## Installation

```bash
npm install @nestjs/swagger swagger-ui-express
```

---

## Configuration dans `main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Mon API')
    .setDescription('Documentation complète de l\'API')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addServer('http://localhost:3000', 'Local')
    .addServer('https://api.monapp.com', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // conserve le token entre les rechargements
    },
  });

  await app.listen(3000);
}
bootstrap();
```

> L'interface est accessible sur **`/api/docs`** et le JSON brut sur **`/api/docs-json`**.

---

## Décorer les contrôleurs

```typescript
import {
  Controller, Get, Post, Body, Param, Delete,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse,
  ApiBearerAuth, ApiParam,
} from '@nestjs/swagger';
import { CreateUserDto } from './dto/create-user.dto';
import { UserEntity } from './entities/user.entity';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {

  @Post()
  @ApiOperation({ summary: 'Créer un utilisateur' })
  @ApiResponse({ status: 201, description: 'Utilisateur créé.', type: UserEntity })
  @ApiResponse({ status: 400, description: 'Données invalides.' })
  @ApiResponse({ status: 409, description: 'Email déjà utilisé.' })
  create(@Body() dto: CreateUserDto) { ... }

  @Get(':id')
  @ApiOperation({ summary: 'Récupérer un utilisateur par ID' })
  @ApiParam({ name: 'id', type: String, description: 'UUID de l\'utilisateur' })
  @ApiResponse({ status: 200, type: UserEntity })
  @ApiResponse({ status: 404, description: 'Utilisateur introuvable.' })
  findOne(@Param('id') id: string) { ... }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un utilisateur' })
  @ApiResponse({ status: 204, description: 'Supprimé avec succès.' })
  remove(@Param('id') id: string) { ... }
}
```

---

## Décorer les DTOs

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({
    example: 'thomas@example.com',
    description: 'Adresse email unique',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'motdepasse123',
    description: 'Mot de passe (min. 8 caractères)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({
    example: 'Thomas',
    description: 'Prénom (optionnel)',
  })
  @IsOptional()
  @IsString()
  firstName?: string;
}
```

### Entité en réponse

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class UserEntity {
  @ApiProperty({ example: 'a1b2c3d4-...', description: 'UUID' })
  id: string;

  @ApiProperty({ example: 'thomas@example.com' })
  email: string;

  @ApiProperty({ example: '2026-04-27T12:00:00.000Z' })
  createdAt: Date;
}
```

---

## Authentification JWT

Après avoir déclaré `addBearerAuth()` dans `main.ts`, décorer le contrôleur ou la route :

```typescript
// Sur tout le contrôleur
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController { ... }

// Ou sur une route spécifique
@ApiBearerAuth('access-token')
@Get('profile')
getProfile() { ... }
```

L'interface Swagger affichera un bouton **Authorize** permettant de saisir le token JWT et de l'inclure automatiquement dans toutes les requêtes.

---

## Grouper les routes avec des tags

`@ApiTags()` regroupe les routes dans l'interface sous un même titre.

```typescript
@ApiTags('users')          // groupe "users"
@ApiTags('auth')           // groupe "auth"
@ApiTags('products')       // groupe "products"
```

Il est possible d'appliquer plusieurs tags à un même contrôleur :

```typescript
@ApiTags('admin', 'users')
```

---

## Réponses typées

### Réponse simple

```typescript
@ApiResponse({ status: 200, type: UserEntity })
```

### Tableau d'objets

```typescript
@ApiResponse({ status: 200, type: [UserEntity] })
// ou
@ApiResponse({ status: 200, isArray: true, type: UserEntity })
```

### Réponse paginée (objet personnalisé)

```typescript
import { ApiExtraModels, getSchemaPath } from '@nestjs/swagger';

export class PaginatedDto<T> {
  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  data: T[];
}

// Dans le contrôleur :
@ApiExtraModels(UserEntity)
@ApiResponse({
  status: 200,
  schema: {
    allOf: [
      { $ref: getSchemaPath(PaginatedDto) },
      {
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(UserEntity) } },
        },
      },
    ],
  },
})
findAll() { ... }
```

---

## Types avancés

### Enum

```typescript
export enum UserRole { ADMIN = 'admin', USER = 'user', GUEST = 'guest' }

@ApiProperty({ enum: UserRole, example: UserRole.USER })
role: UserRole;
```

### Union de types

```typescript
@ApiProperty({ oneOf: [{ type: 'string' }, { type: 'number' }] })
value: string | number;
```

### Objet imbriqué

```typescript
export class AddressDto {
  @ApiProperty({ example: '12 rue de Paris' })
  street: string;

  @ApiProperty({ example: '75001' })
  zipCode: string;
}

export class CreateUserDto {
  // ...
  @ApiProperty({ type: AddressDto })
  address: AddressDto;
}
```

---

## Accès à l'interface

| URL | Description |
|---|---|
| `http://localhost:3000/api/docs` | Interface Swagger UI interactive |
| `http://localhost:3000/api/docs-json` | Schéma OpenAPI au format JSON |
| `http://localhost:3000/api/docs-yaml` | Schéma OpenAPI au format YAML |

### Désactiver Swagger en production

```typescript
if (process.env.NODE_ENV !== 'production') {
  SwaggerModule.setup('api/docs', app, document);
}
```