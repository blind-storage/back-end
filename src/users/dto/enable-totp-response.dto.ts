import { ApiProperty } from '@nestjs/swagger';
import { UserEntity } from '../entities/user.entity';

export class EnableTotpResponseDto {
  @ApiProperty({ type: UserEntity })
  user!: UserEntity;

  @ApiProperty({
    type: [String],
    example: ['A1B2-C3D4-E5F6-7890'],
    description: 'Codes de récupération à usage unique — à conserver précieusement, affichés une seule fois',
  })
  recovery_codes!: string[];
}
