import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma.service';
import { UsersModule } from '../users/users.module';
import { PkiModule } from '../pki/pki.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DropboxAuthGuard } from './guards/dropbox-auth/dropbox-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth/jwt-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth/local-auth.guard';
import { RezelAuthGuard } from './guards/rezel-auth/jwt-auth.guard';
import { RolesGuard } from './guards/roles/roles.guard';
import { SelfOrAdminGuard } from './guards/self-or-admin/self-or-admin.guard';
import { DropboxStrategy } from './strategies/dropbox.strategy/dropbox.strategy';
import { GoogleStrategy } from './strategies/google.strategy/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy/local.strategy';
import { RezelStrategy } from './strategies/rezel.strategy/rezel.strategy';

@Module({
  imports: [
    UsersModule,
    PkiModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PrismaService,
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
    RezelStrategy,
    DropboxStrategy,
    LocalAuthGuard,
    JwtAuthGuard,
    GoogleAuthGuard,
    RezelAuthGuard,
    DropboxAuthGuard,
    RolesGuard,
    SelfOrAdminGuard,
  ],
  exports: [RolesGuard, SelfOrAdminGuard, JwtAuthGuard],
})
export class AuthModule {}
