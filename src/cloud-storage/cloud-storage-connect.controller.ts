import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CloudStorageService, CloudProvider } from './cloud-storage.service';

// Controller PUBLIC (pas de JwtAuthGuard) : le callback est appelé par le navigateur
// lors de la redirection depuis Google/Dropbox, sans en-tête Authorization. L'identité
// de l'utilisateur est portée par le `state` signé (vérifié dans le service).
@ApiTags('cloud-storage')
@Controller('cloud-storage')
export class CloudStorageConnectController {
  constructor(
    private readonly cloudStorageService: CloudStorageService,
    private readonly configService: ConfigService,
  ) {}

  @Get(':provider/callback')
  @ApiOperation({ summary: 'Callback OAuth de connexion d\'un stockage (ne pas appeler directement)' })
  @ApiParam({ name: 'provider', enum: ['google-drive', 'dropbox'] })
  @ApiResponse({ status: 302, description: 'Redirige vers le front avec ?connected ou ?error' })
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const base = this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:8000';

    if (error || !code || !state) {
      res.redirect(`${base}/storage?error=${encodeURIComponent(error ?? 'connexion annulée')}`);
      return;
    }

    try {
      await this.cloudStorageService.handleConnectCallback(provider as CloudProvider, code, state);
      res.redirect(`${base}/storage?connected=${encodeURIComponent(provider)}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'échec de la connexion du stockage';
      res.redirect(`${base}/storage?error=${encodeURIComponent(message)}`);
    }
  }
}
