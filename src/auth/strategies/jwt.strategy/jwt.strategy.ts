import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { Role } from '@blind-storage/types';
import type { JwtUser } from '@blind-storage/types';
import { PrismaService } from '@/prisma.service';

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
    if (payload.oidcPending || payload.oidcNonce || payload.totpPending || payload.storageConnect) {
      throw new UnauthorizedException('Token temporaire non autorisé sur cet endpoint');
    }

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
