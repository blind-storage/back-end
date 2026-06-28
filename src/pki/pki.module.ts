import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PkiController } from './pki.controller';
import { PkiService } from './pki.service';

@Module({
  controllers: [PkiController],
  providers: [PkiService, PrismaService],
  exports: [PkiService],
})
export class PkiModule {}
