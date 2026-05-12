import { ApiProperty } from '@nestjs/swagger';

export class TotpRecoverDto {
  @ApiProperty({ example: 'alice42' })
  username!: string;

  @ApiProperty({ example: 'P@ssw0rd!', format: 'password' })
  password!: string;

  @ApiProperty({ example: 'A1B2-C3D4-E5F6-7890', description: 'Code de récupération TOTP (usage unique)' })
  recovery_code!: string;
}
