import { ApiProperty } from '@nestjs/swagger';

export class OidcLinkPendingResponseDto {
  @ApiProperty({ example: true })
  link_required!: true;

  @ApiProperty({ description: 'Token temporaire à soumettre avec auth_hash pour confirmer le lien' })
  link_token!: string;

  @ApiProperty({ example: 'alice@example.com' })
  email!: string;
}
