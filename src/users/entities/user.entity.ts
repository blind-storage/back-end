import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/enums';
import type { UserModel } from '../../generated/prisma/models/User';

export class UserEntity {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  pub_key: string;

  @ApiProperty({ enum: Role, default: Role.USER })
  role: Role;

  @ApiProperty()
  totpEnabled: boolean;

  @ApiPropertyOptional({ description: 'Codes de récupération TOTP restants (non utilisés)' })
  totp_recovery_codes_remaining?: number;

  constructor(user: UserModel, totpRecoveryCodesRemaining?: number) {
    this.id = user.id;
    this.email = user.email;
    this.username = user.username;
    this.pub_key = user.pub_key;
    this.role = ((user as any).role as Role) ?? Role.USER;
    this.totpEnabled = user.totpEnabled;
    if (totpRecoveryCodesRemaining !== undefined) {
      this.totp_recovery_codes_remaining = totpRecoveryCodesRemaining;
    }
  }
}
