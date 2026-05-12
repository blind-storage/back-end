import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-openidconnect';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { PrismaService } from '@/prisma.service';
import { OidcProvider } from '@/generated/prisma/enums';

@Injectable()
export class RezelStrategy extends PassportStrategy(Strategy, 'rezel') {
  constructor(
    private prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    super({
      issuer:           process.env.REZEL_ISSUER_URL   ?? (() => { throw new Error('REZEL_ISSUER_URL is not defined'); })(),
      authorizationURL: process.env.REZEL_AUTH_URL     ?? (() => { throw new Error('REZEL_AUTH_URL is not defined'); })(),
      tokenURL:         process.env.REZEL_TOKEN_URL    ?? (() => { throw new Error('REZEL_TOKEN_URL is not defined'); })(),
      userInfoURL:      process.env.REZEL_USERINFO_URL ?? (() => { throw new Error('REZEL_USERINFO_URL is not defined'); })(),
      clientID:         process.env.REZEL_CLIENT_ID    ?? (() => { throw new Error('REZEL_CLIENT_ID is not defined'); })(),
      clientSecret:     process.env.REZEL_SECRET       ?? (() => { throw new Error('REZEL_SECRET is not defined'); })(),
      callbackURL:      process.env.REZEL_CALLBACK_URL ?? (() => { throw new Error('REZEL_CALLBACK_URL is not defined'); })(),
      scope: ['openid', 'profile', 'email'],
    });
  }

  async validate(
    _issuer: string,
    profile: any,
    _context: any,
    _idToken: string,
    accessToken: string,
    refreshToken: string,
    done: Function,
  ): Promise<any> {
    const email = profile.emails?.[0]?.value ?? profile._json?.email;
    const providerUserId = profile.id ?? profile._json?.sub;

    const user = await this.prisma.user.findUnique({ where: { email } });

    const connection = await this.prisma.oidcConnection.findUnique({
      where: {
        provider_providerUserId: {
          provider: OidcProvider.REZEL,
          providerUserId,
        },
      },
      include: { user: true },
    });

    if (!connection) {
      if (user) {
        this.logger.warn('Rezel login: existing account found, returning pending link', {
          context: RezelStrategy.name,
          audit: { action: 'REZEL_AUTH_PENDING_LINK', providerUserId, email },
        });
        done(null, {
          pendingLink: true,
          userId: user.id,
          provider: OidcProvider.REZEL,
          providerUserId,
          email,
          accessToken,
          refreshToken: refreshToken ?? null,
        });
        return;
      }

      this.logger.warn('Rezel login: no account found, returning pending setup', {
        context: RezelStrategy.name,
        audit: { action: 'REZEL_AUTH_PENDING_SETUP', providerUserId, email },
      });
      done(null, {
        pendingSetup: true,
        provider: OidcProvider.REZEL,
        providerUserId,
        email,
        accessToken,
        refreshToken: refreshToken ?? null,
      });
      return;
    }

    await this.prisma.oidcConnection.update({
      where: { id: connection.id },
      data: { accessToken, refreshToken, email },
    });

    this.logger.info('Rezel authentication successful', {
      context: RezelStrategy.name,
      audit: { action: 'REZEL_AUTH_SUCCESS', userId: connection.user.id },
    });

    done(null, connection.user);
  }
}
