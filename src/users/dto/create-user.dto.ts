import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'alice@example.com' })
  email: string;

  @ApiProperty({ example: 'alice' })
  username: string;

  @ApiProperty({ description: 'Clé publique' })
  pub_key: string;

  @ApiProperty({ description: 'Clé privée chiffrée (dérivée du mot de passe)' })
  priv_key_enc_1: string;

  @ApiProperty({ description: 'Clé privée chiffrée (dérivée du code de récupération)' })
  priv_key_enc_2: string;

  @ApiPropertyOptional({ description: 'Null si authentification uniquement via OIDC' })
  auth_hash?: string;

  @ApiPropertyOptional({ description: 'Salt pour la dérivation du mot de passe maître' })
  salt_mp?: string;

  @ApiPropertyOptional({ description: 'Salt pour la dérivation du code de récupération' })
  salt_rc?: string;
}
