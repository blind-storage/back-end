import { ApiProperty } from '@nestjs/swagger';
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

  @ApiProperty()
  totpEnabled: boolean;

  constructor(user: UserModel) {
    this.id = user.id;
    this.email = user.email;
    this.username = user.username;
    this.pub_key = user.pub_key;
    this.totpEnabled = user.totpEnabled;
  }
}
