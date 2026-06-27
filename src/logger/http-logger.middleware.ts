import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const { method, originalUrl, ip } = req;

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;
      const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

      this.logger.log(level, `${method} ${originalUrl}`, {
        http: {
          method,
          path: originalUrl,
          status_code: statusCode,
          duration_ms: duration,
          client_ip: ip,
          user_agent: req.headers['user-agent'],
          request_size: req.headers['content-length'] ?? 0,
          response_size: res.getHeader('content-length') ?? 0,
        },
      });
    });

    next();
  }
}