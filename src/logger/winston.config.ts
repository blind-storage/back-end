import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import * as winston from 'winston';
import LokiTransport from 'winston-loki';
import { asyncLocalStorage } from './correlation.middleware';
import { maskSensitiveData } from './sensitive.filter';

const SERVICE_NAME = process.env.SERVICE_NAME ?? 'nestjs-app';
const ENV = process.env.NODE_ENV ?? 'development';

// Format ECS (Elastic Common Schema) compatible Elasticsearch / Splunk / Graylog
const ecsFormat = winston.format((info) => {
  const store = asyncLocalStorage.getStore();

  const log: Record<string, unknown> = {
    '@timestamp': new Date().toISOString(),
    'log.level': info.level,
    'service.name': SERVICE_NAME,
    'service.environment': ENV,
    'correlation.id': store?.get('correlationId') ?? '-',
    'user.id': store?.get('userId') ?? 'anonymous',
    message: info.message,
    ...(info.http ? { http: maskSensitiveData(info.http) } : {}),
    ...(info.stack ? { 'error.stack_trace': info.stack } : {}),
    ...(info.context ? { 'log.logger': info.context } : {}),
  };

  // Masque les données sensibles dans le payload complet
  return maskSensitiveData(log) as winston.Logform.TransformableInfo;
})();

// Format lisible pour la console en dev
const devFormat = winston.format.combine(
  winston.format.timestamp(),
  nestWinstonModuleUtilities.format.nestLike(SERVICE_NAME, {
    prettyPrint: true,
    colors: true,
  }),
);

// Filtre par niveau
const levelFilter = (level: string) =>
  winston.format((info) => (info.level === level ? info : false))();

export const winstonConfig: winston.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  transports: [
    // Console (dev uniquement)
    ...(ENV !== 'production'
      ? [new winston.transports.Console({ format: devFormat })]
      : []),

    // access.log — toutes les requêtes HTTP (info)
    new winston.transports.File({
      filename: 'logs/access.log',
      format: winston.format.combine(
        levelFilter('info'),
        ecsFormat,
        winston.format.json(),
      ),
    }),

    // error.log — erreurs uniquement
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(ecsFormat, winston.format.json()),
    }),

    // audit.log — actions utilisateurs (niveau 'warn' utilisé comme canal audit)
    new winston.transports.File({
      filename: 'logs/audit.log',
      format: winston.format.combine(
        levelFilter('warn'),
        ecsFormat,
        winston.format.json(),
      ),
    }),

    new LokiTransport({
      host: process.env.LOKI_URL ?? 'http://localhost:3100',
      labels: { app: SERVICE_NAME, env: ENV },
      json: true,
      format: winston.format.combine(ecsFormat, winston.format.json()),
    }),
  ],
};