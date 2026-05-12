import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';


async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = new DocumentBuilder()
    .setTitle('Mon API')
    .setDescription('Description de l\'API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document); // accessible sur /api/docs
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  await app.listen(3000);
}
bootstrap();