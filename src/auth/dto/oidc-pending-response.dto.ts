import { ApiProperty } from '@nestjs/swagger';

export class OidcPendingResponseDto {
  @ApiProperty({ description: 'Indique que la configuration initiale du compte est requise', example: true })
  setup_required!: true;

  @ApiProperty({ description: 'Token temporaire (15 min) pour finaliser la configuration' })
  setup_token!: string;

  @ApiProperty({ example: 'alice@example.com', description: 'Email fourni par le fournisseur OIDC' })
  email!: string;
}
