import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CloudStorageController } from './cloud-storage.controller';
import { CloudStorageConnectController } from './cloud-storage-connect.controller';
import { CloudStorageService } from './cloud-storage.service';
import { GoogleDriveService } from './providers/google-drive.service';
import { DropboxService } from './providers/dropbox.service';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    ConfigModule,
    // Pour signer/vérifier le `state` OAuth (même secret que le reste de l'app).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
  ],
  controllers: [CloudStorageController, CloudStorageConnectController],
  providers: [CloudStorageService, GoogleDriveService, DropboxService, PrismaService],
  exports: [CloudStorageService],
})
export class CloudStorageModule {}
