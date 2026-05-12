import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'alice42' })
  username: string;

  @ApiProperty({ example: 'P@ssw0rd!', format: 'password' })
  password: string;
}
