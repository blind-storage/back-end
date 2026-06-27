# Logger structuré NestJS — Transport Loki / Grafana

## Sommaire

- [Installation](#installation)
- [Structure des fichiers](#structure-des-fichiers)
- [Correlation Middleware](#1-correlation-middleware)
- [Masquage des données sensibles](#2-masquage-des-données-sensibles)
- [Configuration Winston + Loki](#3-configuration-winston--loki)
- [HTTP Logger Middleware](#4-http-logger-middleware)
- [Assemblage dans AppModule](#5-assemblage-dans-appmodule)
- [Bootstrapping dans main.ts](#6-bootstrapping-dans-maints)
- [Utilisation dans les services](#utilisation-dans-les-services)
- [Format de log produit](#format-de-log-produit)
- [Séparation des fichiers de logs](#séparation-des-fichiers-de-logs)
- [Visualisation dans Grafana](#visualisation-dans-grafana)

---

## Installation

```bash
npm install nest-winston winston winston-loki uuid
npm install -D @types/uuid
```

---

## Structure des fichiers

```
src/
└── logger/
    ├── correlation.middleware.ts   # Génère et propage le correlation_id
    ├── sensitive.filter.ts         # Masque les données sensibles
    ├── winston.config.ts           # Configuration Winston + transports
    └── http-logger.middleware.ts   # Log structuré de chaque requête HTTP
```

---

## 1. Correlation Middleware

Génère un `correlation_id` UUID unique par requête et le propage via `AsyncLocalStorage` à tous les services actifs pendant la requête, sans injection manuelle.

```typescript
// src/logger/correlation.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

export const asyncLocalStorage = new AsyncLocalStorage<Map<string, string>>();

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ?? uuidv4();

    res.setHeader('x-correlation-id', correlationId);

    const store = new Map<string, string>();
    store.set('correlationId', correlationId);
    store.set('userId', (req as any).user?.id ?? 'anonymous');

    asyncLocalStorage.run(store, () => next());
  }
}
```

> Le header `x-correlation-id` est renvoyé dans la réponse pour permettre au client de corréler ses propres traces.

---

## 2. Masquage des données sensibles

Filtre appliqué avant chaque écriture de log. Les clés listées sont remplacées par `[REDACTED]` dans les objets JSON et les chaînes de caractères.

```typescript
// src/logger/sensitive.filter.ts
const SENSITIVE_KEYS = [
  'password', 'passwd', 'secret', 'token', 'authorization',
  'access_token', 'refresh_token', 'apiKey', 'api_key',
  'credit_card', 'ssn', 'cvv',
];

const SENSITIVE_PATTERN = new RegExp(
  `("(?:${SENSITIVE_KEYS.join('|')})"\\s*:\\s*)"[^"]*"`,
  'gi',
);

export function maskSensitiveData(data: unknown): unknown {
  if (typeof data === 'string') {
    return data.replace(SENSITIVE_PATTERN, '$1"[REDACTED]"');
  }
  if (typeof data === 'object' && data !== null) {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      masked[key] = SENSITIVE_KEYS.some((k) =>
        key.toLowerCase().includes(k),
      )
        ? '[REDACTED]'
        : maskSensitiveData(value);
    }
    return masked;
  }
  return data;
}
```

**Clés masquées par défaut :** `password`, `passwd`, `secret`, `token`, `authorization`, `access_token`, `refresh_token`, `apiKey`, `api_key`, `credit_card`, `ssn`, `cvv`.

Pour ajouter une clé, l'ajouter au tableau `SENSITIVE_KEYS`.

---

## 3. Configuration Winston + Loki

Le format de log suit le schéma **ECS (Elastic Common Schema)**, compatible avec Loki, Elasticsearch, Splunk et Graylog.

```typescript
// src/logger/winston.config.ts
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import * as winston from 'winston';
import LokiTransport from 'winston-loki';
import { asyncLocalStorage } from './correlation.middleware';
import { maskSensitiveData } from './sensitive.filter';

const SERVICE_NAME = process.env.SERVICE_NAME ?? 'nestjs-app';
const ENV        = process.env.NODE_ENV        ?? 'development';
const LOKI_URL   = process.env.LOKI_URL        ?? 'http://localhost:3100';

// Format ECS — enrichit chaque log avec les champs standardisés
const ecsFormat = winston.format((info) => {
  const store = asyncLocalStorage.getStore();

  const log: Record<string, unknown> = {
    '@timestamp':          new Date().toISOString(),
    'log.level':           info.level,
    'service.name':        SERVICE_NAME,
    'service.environment': ENV,
    'correlation.id':      store?.get('correlationId') ?? '-',
    'user.id':             store?.get('userId')        ?? 'anonymous',
    message:               info.message,
    ...(info.http    && { http:              maskSensitiveData(info.http) }),
    ...(info.stack   && { 'error.stack_trace': info.stack }),
    ...(info.context && { 'log.logger':        info.context }),
  };

  return maskSensitiveData(log) as winston.Logform.TransformableInfo;
})();

// Filtre par niveau exact (pour la séparation des fichiers)
const levelFilter = (level: string) =>
  winston.format((info) => (info.level === level ? info : false))();

// Format console lisible pour le développement
const devFormat = winston.format.combine(
  winston.format.timestamp(),
  nestWinstonModuleUtilities.format.nestLike(SERVICE_NAME, {
    prettyPrint: true,
    colors: true,
  }),
);

export const winstonConfig: winston.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  transports: [

    // ── Console (dev uniquement) ─────────────────────────────────────────
    ...(ENV !== 'production'
      ? [new winston.transports.Console({ format: devFormat })]
      : []),

    // ── Fichiers locaux ──────────────────────────────────────────────────

    // access.log — toutes les requêtes HTTP réussies (niveau info)
    new winston.transports.File({
      filename: 'logs/access.log',
      format: winston.format.combine(
        levelFilter('info'),
        ecsFormat,
        winston.format.json(),
      ),
    }),

    // error.log — erreurs 5xx et exceptions non catchées
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(ecsFormat, winston.format.json()),
    }),

    // audit.log — actions utilisateurs sensibles (canal warn)
    new winston.transports.File({
      filename: 'logs/audit.log',
      format: winston.format.combine(
        levelFilter('warn'),
        ecsFormat,
        winston.format.json(),
      ),
    }),

    // ── Loki / Grafana ───────────────────────────────────────────────────
    new LokiTransport({
      host:   LOKI_URL,
      labels: {
        app:         SERVICE_NAME,
        environment: ENV,
      },
      json:         true,
      batching:     true,
      interval:     5,           // envoi par batch toutes les 5 secondes
      format: winston.format.combine(ecsFormat, winston.format.json()),
      // Ajoute le niveau comme label Loki pour filtrer dans Grafana
      onConnectionError: (err) => console.error('Loki connection error:', err),
    }),
  ],
};
```

### Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `SERVICE_NAME` | `nestjs-app` | Nom du service dans les logs et labels Loki |
| `NODE_ENV` | `development` | Active/désactive la console et le format dev |
| `LOKI_URL` | `http://localhost:3100` | URL du serveur Loki |
| `LOG_LEVEL` | `info` | Niveau minimum (`error`, `warn`, `info`, `debug`) |

---

## 4. HTTP Logger Middleware

Log structuré de chaque requête avec les champs HTTP standardisés. Le niveau est adapté au code de réponse : `error` pour 5xx, `warn` pour 4xx, `info` sinon.

```typescript
// src/logger/http-logger.middleware.ts
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
      const level =
        statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

      this.logger.log(level, `${method} ${originalUrl}`, {
        http: {
          method,
          path:          originalUrl,
          status_code:   statusCode,
          duration_ms:   duration,
          client_ip:     ip,
          user_agent:    req.headers['user-agent'],
          request_size:  req.headers['content-length'] ?? 0,
          response_size: res.getHeader('content-length') ?? 0,
        },
      });
    });

    next();
  }
}
```

---

## 5. Assemblage dans `AppModule`

> `CorrelationMiddleware` **doit être déclaré avant** `HttpLoggerMiddleware` pour que le `correlation_id` soit disponible au moment du log.

```typescript
// src/app.module.ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { winstonConfig } from './logger/winston.config';
import { CorrelationMiddleware } from './logger/correlation.middleware';
import { HttpLoggerMiddleware } from './logger/http-logger.middleware';

@Module({
  imports: [
    WinstonModule.forRoot(winstonConfig),
    // ... autres modules
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationMiddleware, HttpLoggerMiddleware)
      .forRoutes('*');
  }
}
```

---

## 6. Bootstrapping dans `main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  await app.listen(3000);
}
bootstrap();
```

`bufferLogs: true` conserve les logs émis pendant le démarrage et les rejoue via Winston une fois le logger initialisé.

---

## Utilisation dans les services

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

@Injectable()
export class UsersService {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async findAll() {
    this.logger.info('Récupération de tous les utilisateurs', {
      context: UsersService.name,
    });
    // ...
  }

  async deleteUser(id: string) {
    // Audit log (canal warn)
    this.logger.warn(`Suppression utilisateur ${id}`, {
      context: UsersService.name,
      audit: { action: 'DELETE_USER', targetId: id },
    });
    // ...
  }

  async handleError(err: Error) {
    this.logger.error('Erreur inattendue', {
      context: UsersService.name,
      stack:   err.stack,
      message: err.message,
    });
  }
}
```

### Conventions de niveau

| Niveau | Cas d'usage |
|---|---|
| `error` | Exception non catchée, erreur 5xx, perte de connexion DB |
| `warn` | Erreur 4xx, action d'audit (DELETE, UPDATE sensible), tentative bloquée |
| `info` | Requête HTTP réussie, démarrage de service, événement métier normal |
| `debug` | Données internes pour débogage (désactivé en production) |

---

## Format de log produit

Chaque ligne écrite dans les fichiers et envoyée à Loki est un objet JSON plat :

```json
{
  "@timestamp":          "2026-04-27T14:32:01.123Z",
  "log.level":           "info",
  "service.name":        "nestjs-app",
  "service.environment": "production",
  "correlation.id":      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "user.id":             "usr_42",
  "message":             "GET /api/users",
  "http": {
    "method":       "GET",
    "path":         "/api/users",
    "status_code":  200,
    "duration_ms":  47,
    "client_ip":    "192.168.1.10",
    "user_agent":   "Mozilla/5.0 ..."
  }
}
```

---

## Séparation des fichiers de logs

| Fichier | Niveau | Contenu |
|---|---|---|
| `logs/access.log` | `info` | Toutes les requêtes HTTP réussies |
| `logs/error.log` | `error` | Erreurs 5xx et exceptions |
| `logs/audit.log` | `warn` | Actions utilisateurs sensibles |

---

## Visualisation dans Grafana

### Requêtes LogQL utiles

```logql
# Toutes les requêtes d'un utilisateur
{app="nestjs-app"} | json | line_format "{{.message}}" | `user.id`="usr_42"

# Requêtes lentes (> 500ms)
{app="nestjs-app"} | json | `http.duration_ms` > 500

# Erreurs 5xx sur les dernières 24h
{app="nestjs-app"} | json | `http.status_code` >= 500

# Tracer une requête complète par correlation_id
{app="nestjs-app"} | json | `correlation.id`="a1b2c3d4-..."

# Taux d'erreur par endpoint
sum by (http_path) (
  rate({app="nestjs-app"} | json | `http.status_code` >= 500 [5m])
)
```

### Labels Loki configurés

| Label | Valeur | Usage |
|---|---|---|
| `app` | `nestjs-app` | Filtrer par application |
| `environment` | `production` / `development` | Séparer les environnements |

> Pour ajouter un label (ex: `region`), l'ajouter dans le champ `labels` du `LokiTransport` dans `winston.config.ts`. Les labels Loki doivent rester peu nombreux — les données métier vont dans le JSON du log, pas dans les labels.