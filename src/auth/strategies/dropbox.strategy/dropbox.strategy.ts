import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-dropbox-oauth2';
import { Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { PrismaService } from '@/prisma.service';
import { OidcProvider } from '@blind-storage/types';

const DROPBOX_STORAGE_SCOPES = [
  'account_info.read',
  'files.metadata.read',
  'files.metadata.write',
  'files.content.write',
  'files.content.read',
];

@Injectable()
export class DropboxStrategy extends PassportStrategy(Strategy, 'dropbox') {
  constructor(
    private prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    super({
      apiVersion:   '2',
      clientID:     process.env.DROPBOX_CLIENT_ID     ?? (() => { throw new Error('DROPBOX_CLIENT_ID is not defined'); })(),
      clientSecret: process.env.DROPBOX_CLIENT_SECRET ?? (() => { throw new Error('DROPBOX_CLIENT_SECRET is not defined'); })(),
      callbackURL:  process.env.DROPBOX_CALLBACK_URL  ?? (() => { throw new Error('DROPBOX_CALLBACK_URL is not defined'); })(),
      scope: DROPBOX_STORAGE_SCOPES,
    });
  }

  authorizationParams(): Record<string, string> {
    return { token_access_type: 'offline' };
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: Function): Promise<any> {
    const providerUserId = profile.id ?? profile._json?.account_id;
    const email = profile.emails?.[0]?.value ?? profile._json?.email;

    const connection = await this.prisma.oidcConnection.findUnique({
      where: {
        provider_providerUserId: {
          provider: OidcProvider.DROPBOX,
          providerUserId,
        },
      },
      include: { user: true },
    });

    if (!connection) {
      const existingUser = email
        ? await this.prisma.user.findUnique({ where: { email } })
        : null;

      if (existingUser) {
        this.logger.warn(
          'Dropbox login: existing account found, returning pending link',
          {
            context: DropboxStrategy.name,
            audit: {
              action: 'DROPBOX_AUTH_PENDING_LINK',
              providerUserId,
              email,
            },
          },
        );
        done(null, {
          pendingLink: true,
          userId: existingUser.id,
          provider: OidcProvider.DROPBOX,
          providerUserId,
          email,
          accessToken,
          refreshToken: refreshToken ?? null,
        });
        return;
      }

      this.logger.warn(
        'Dropbox login: no account found, returning pending setup',
        {
          context: DropboxStrategy.name,
          audit: {
            action: 'DROPBOX_AUTH_PENDING_SETUP',
            providerUserId,
            email,
          },
        },
      );
      done(null, {
        pendingSetup: true,
        provider: OidcProvider.DROPBOX,
        providerUserId,
        email,
        accessToken,
        refreshToken: refreshToken ?? null,
      });
      return;
    }

    await this.prisma.oidcConnection.update({
      where: { id: connection.id },
      data: {
        email,
        accessToken,
        refreshToken: refreshToken ?? connection.refreshToken,
        driveScope: true,
      },
    });

    this.logger.info('Dropbox authentication successful', {
      context: DropboxStrategy.name,
      audit: { action: 'DROPBOX_AUTH_SUCCESS', userId: connection.user.id },
    });

    done(null, connection.user);
  }
}
