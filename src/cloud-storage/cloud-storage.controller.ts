import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { CloudStorageService, CloudProvider } from './cloud-storage.service';

@ApiTags('cloud-storage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cloud-storage')
export class CloudStorageController {
  constructor(
    private readonly cloudStorageService: CloudStorageService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  @Get('files')
  @ApiOperation({ summary: "Lister les fichiers de l'utilisateur connecté" })
  @ApiResponse({ status: 200, description: 'Liste des fichiers' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  async listFiles(@Req() req: any) {
    const userId = (req.user as any).id;
    const files = await this.cloudStorageService.listFiles(userId);
    return { files };
  }

  @Post(':provider/upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Uploader un fichier vers un provider cloud' })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'provider', enum: ['google-drive', 'dropbox'], description: 'Provider de stockage' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'enc_fek'],
      properties: {
        file: { type: 'string', format: 'binary' },
        enc_fek: { type: 'string', description: "Clé de chiffrement du fichier chiffrée pour l'utilisateur" },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Fichier uploadé, retourne le fileId DB' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 400, description: 'Provider inconnu' })
  async uploadFile(
    @Param('provider') provider: string,
    @Req() req: any,
    @UploadedFile() file: { originalname: string; buffer: Buffer; mimetype: string },
    @Body('enc_fek') encFek: string,
  ) {
    const userId = (req.user as any).id;
    const result = await this.cloudStorageService.uploadFile(
      provider as CloudProvider,
      file.originalname,
      file.buffer,
      file.mimetype,
      userId,
      encFek,
    );
    return { fileId: result.fileId, message: 'Fichier uploadé avec succès' };
  }

  @Get('files/:fileId/download')
  @ApiOperation({ summary: 'Télécharger un fichier par son ID base de données' })
  @ApiParam({ name: 'fileId', description: 'UUID du fichier en base de données' })
  @ApiResponse({ status: 200, description: 'Contenu binaire du fichier' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Accès refusé' })
  @ApiResponse({ status: 404, description: 'Fichier introuvable' })
  async downloadFile(
    @Param('fileId') fileId: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    const userId = (req.user as any).id;
    const buffer = await this.cloudStorageService.downloadFile(fileId, userId);
    res.set({ 'Content-Type': 'application/octet-stream' });
    res.send(buffer);
  }

  @Delete('files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un fichier par son ID base de données' })
  @ApiParam({ name: 'fileId', description: 'UUID du fichier en base de données' })
  @ApiResponse({ status: 204, description: 'Fichier supprimé' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Accès refusé' })
  @ApiResponse({ status: 404, description: 'Fichier introuvable' })
  async deleteFile(@Param('fileId') fileId: string, @Req() req: any) {
    const userId = (req.user as any).id;
    await this.cloudStorageService.deleteFile(fileId, userId);
  }

  // ─── Connexion des stockages (découplée du login) ──────────────────────────

  @Get('providers')
  @ApiOperation({ summary: 'Statut de connexion des stockages de l\'utilisateur' })
  @ApiResponse({ status: 200, description: '{ "google-drive": { connected }, "dropbox": { connected } }' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  async providersStatus(@Req() req: any) {
    return this.cloudStorageService.getProvidersStatus((req.user as any).id);
  }

  @Get(':provider/connect')
  @ApiOperation({ summary: "URL de consentement OAuth pour connecter un stockage (le client y redirige le navigateur)" })
  @ApiParam({ name: 'provider', enum: ['google-drive', 'dropbox'] })
  @ApiResponse({ status: 200, description: '{ url }' })
  @ApiResponse({ status: 400, description: 'Provider inconnu' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  async connect(@Param('provider') provider: string, @Req() req: any): Promise<{ url: string }> {
    const url = await this.cloudStorageService.getConnectUrl(
      provider as CloudProvider,
      (req.user as any).id,
    );
    return { url };
  }
}
