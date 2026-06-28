import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { PrismaService } from '@/prisma.service';
import { OidcProvider } from '@blind-storage/types';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    super({
      clientID:
        process.env.GOOGLE_CLIENT_ID ??
        (() => {
          throw new Error('GOOGLE_CLIENT_ID is not defined');
        })(),
      clientSecret:
        process.env.GOOGLE_SECRET ??
        (() => {
          throw new Error('GOOGLE_SECRET is not defined');
        })(),
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ??
        (() => {
          throw new Error('GOOGLE_CALLBACK_URL is not defined');
        })(),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { emails, id: providerUserId } = profile;
    const email = emails[0].value;

    const connection = await this.prisma.oidcConnection.findUnique({
      where: {
        provider_providerUserId: {
          provider: OidcProvider.GOOGLE,
          providerUserId,
        },
      },
      include: { user: true },
    });

    if (!connection) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        this.logger.warn(
          'Google login: existing account found, returning pending link',
          {
            context: GoogleStrategy.name,
            audit: {
              action: 'GOOGLE_AUTH_PENDING_LINK',
              providerUserId,
              email,
            },
          },
        );
        done(null, {
          pendingLink: true,
          userId: existingUser.id,
          provider: OidcProvider.GOOGLE,
          providerUserId,
          email,
          accessToken,
          refreshToken: refreshToken ?? null,
        });
        return;
      }

      this.logger.warn(
        'Google login: no account found, returning pending setup',
        {
          context: GoogleStrategy.name,
          audit: { action: 'GOOGLE_AUTH_PENDING_SETUP', providerUserId, email },
        },
      );
      done(null, {
        pendingSetup: true,
        provider: OidcProvider.GOOGLE,
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

    this.logger.info('Google authentication successful', {
      context: GoogleStrategy.name,
      audit: { action: 'GOOGLE_AUTH_SUCCESS', userId: connection.user.id },
    });

    done(null, connection.user);
  }
}
