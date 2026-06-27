import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export const asyncLocalStorage = new AsyncLocalStorage<Map<string, string>>();

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ?? randomUUID();

    res.setHeader('x-correlation-id', correlationId);

    const store = new Map<string, string>();
    store.set('correlationId', correlationId);
    store.set('userId', (req as any).user?.id ?? 'anonymous');

    asyncLocalStorage.run(store, () => next());
  }
}