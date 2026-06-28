import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PkiService } from './pki.service';

@ApiTags('pki')
@Controller('pki')
export class PkiController {
  constructor(private readonly pkiService: PkiService) {}

  @Get('ca')
  @ApiOperation({ summary: 'Retourne la clé publique de la CA' })
  getCa(): { pub_key: string } {
    return { pub_key: this.pkiService.getCaPublicKey() };
  }

  @Get('crl')
  @ApiOperation({ summary: 'Retourne la liste de révocation signée par la CA' })
  async getCrl() {
    return this.pkiService.getCrl();
  }
}
