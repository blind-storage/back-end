import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class RezelAuthGuard extends AuthGuard('rezel') {
  private readonly logger = new Logger(RezelAuthGuard.name);

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      this.logger.error('Rezel auth failed', {
        error: err?.message ?? err,
        info: info?.message ?? info,
        stack: err?.stack,
      });
      throw err || new UnauthorizedException();
    }
    return user;
  }
}
