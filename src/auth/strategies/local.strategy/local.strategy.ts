import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { AuthService } from '@/auth/auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(
    private authService: AuthService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    super();
  }

  async validate(username: string, password: string): Promise<any> {
    const user = await this.authService.validateUser(username, password);

    if (!user) {
      this.logger.warn('Failed login attempt', {
        context: LocalStrategy.name,
        audit: { action: 'LOCAL_AUTH_FAILED', username },
      });
      throw new UnauthorizedException('Identifiants incorrects');
    }

    this.logger.info('Local authentication successful', {
      context: LocalStrategy.name,
      audit: { action: 'LOCAL_AUTH_SUCCESS', userId: user.id },
    });

    return user;
  }
}
