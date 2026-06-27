import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { SelfOrAdminGuard } from '../auth/guards/self-or-admin/self-or-admin.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    PrismaService,
    JwtAuthGuard,
    RolesGuard,
    SelfOrAdminGuard,
  ],
  exports: [UsersService],
})
export class UsersModule {}
