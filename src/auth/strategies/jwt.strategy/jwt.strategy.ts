import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { PrismaService } from '@/prisma.service';
import { Role } from '@/generated/prisma/enums';
import type { UserModel } from '@/generated/prisma/models/User';

export type JwtPayload = {
  sub: string;
  email: string;
  username: string;
  role: Role;
};

export type JwtUser = Omit<UserModel, 'auth_hash' | 'salt_mp' | 'salt_rc' | 'totpSecret'> & {
  role: Role;
};

export type PendingSetupPayload = {
  pending: true;
  provider: string;
  providerUserId: string;
  email: string;
  accessToken: string;
  refreshToken: string | null;
};

export type PendingLinkPayload = {
  pendingLink: true;
  userId: string;
  provider: string;
  providerUserId: string;
  email: string;
  accessToken: string;
  refreshToken: string | null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? (() => { throw new Error('JWT_SECRET is not defined'); })(),
    });
  }

  async validate(payload: any): Promise<JwtUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      this.logger.warn('JWT valid but user not found', {
        context: JwtStrategy.name,
        audit: { action: 'JWT_AUTH_FAILED', sub: payload.sub },
      });
      throw new UnauthorizedException('Utilisateur introuvable');
    }

    this.logger.info('JWT authentication successful', {
      context: JwtStrategy.name,
      audit: { action: 'JWT_AUTH_SUCCESS', userId: user.id },
    });

    const { auth_hash, salt_mp, salt_rc, totpSecret, ...result } = user;
    return result as JwtUser;
  }
}
