import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
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
import { CloudStorageService } from './cloud-storage.service';
import type { CloudProvider } from './cloud-storage.service';

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

  @Get('browse')
  @ApiOperation({ summary: "Contenu d'un dossier : sous-dossiers + fichiers + fil d'Ariane" })
  @ApiResponse({ status: 200, description: '{ folder, breadcrumb, folders, files }' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Accès refusé au dossier' })
  async browse(
    @Req() req: any,
    @Query('folderId') folderId?: string,
    @Query('provider') provider: CloudProvider = 'google-drive',
  ) {
    const userId = (req.user as any).id;
    return this.cloudStorageService.browse(userId, folderId || null, provider);
  }

  @Get('shared-with-me')
  @ApiOperation({ summary: "Lister les fichiers partagés avec l'utilisateur connecté" })
  @ApiResponse({ status: 200, description: '{ files }' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  async sharedWithMe(@Req() req: any) {
    const userId = (req.user as any).id;
    const files = await this.cloudStorageService.listSharedWithMe(userId);
    return { files };
  }

  // ─── Dossiers (arborescence virtuelle) ─────────────────────────────────────

  @Post('folders')
  @ApiOperation({ summary: 'Créer un dossier' })
  @ApiBody({ schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, parentId: { type: 'string', nullable: true } } } })
  @ApiResponse({ status: 201, description: 'Dossier créé' })
  async createFolder(
    @Req() req: any,
    @Body() body: { name: string; parentId?: string | null; provider?: CloudProvider },
  ) {
    const userId = (req.user as any).id;
    return this.cloudStorageService.createFolder(userId, body.name, body.parentId ?? null, body.provider ?? 'google-drive');
  }

  @Patch('folders/:id')
  @ApiOperation({ summary: 'Renommer (name) et/ou déplacer (parentId) un dossier' })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiBody({ schema: { type: 'object', properties: { name: { type: 'string' }, parentId: { type: 'string', nullable: true } } } })
  @ApiResponse({ status: 200, description: 'Dossier mis à jour' })
  async updateFolder(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { name?: string; parentId?: string | null },
  ) {
    const userId = (req.user as any).id;
    return this.cloudStorageService.updateFolder(userId, id, body);
  }

  @Delete('folders/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un dossier et tout son contenu (récursif)' })
  @ApiParam({ name: 'id', description: 'UUID du dossier' })
  @ApiResponse({ status: 204, description: 'Dossier supprimé' })
  async deleteFolder(@Param('id') id: string, @Req() req: any) {
    const userId = (req.user as any).id;
    await this.cloudStorageService.deleteFolder(userId, id);
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
        signature: { type: 'string', description: 'Signature ECDSA du blob chiffré', nullable: true },
        replaceFileId: { type: 'string', nullable: true, description: 'Fichier existant à remplacer si conflit de nom' },
        replaceMode: { type: 'string', enum: ['preserve', 'rotate'], nullable: true },
        replacementShares: { type: 'string', nullable: true, description: 'JSON des enc_fek des destinataires conservés' },
        folderId: { type: 'string', nullable: true, description: 'Dossier de destination (vide = racine)' },
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
    @Body('signature') signature?: string,
    @Body('folderId') folderId?: string,
    @Body('replaceFileId') replaceFileId?: string,
    @Body('replaceMode') replaceMode?: 'preserve' | 'rotate',
    @Body('replacementShares') replacementSharesRaw?: string,
  ) {
    const userId = (req.user as any).id;
    let replacementShares: Array<{ userId: string; enc_fek: string }> = [];
    if (replacementSharesRaw) {
      try {
        replacementShares = JSON.parse(replacementSharesRaw);
      } catch {
        replacementShares = [];
      }
    }
    const result = await this.cloudStorageService.uploadFile(
      provider as CloudProvider,
      file.originalname,
      file.buffer,
      file.mimetype,
      userId,
      encFek,
      folderId || null,
      signature,
      replaceFileId || null,
      replaceMode ?? 'preserve',
      replacementShares,
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

  @Patch('files/:fileId')
  @ApiOperation({ summary: 'Renommer (name) et/ou déplacer (folderId) un fichier' })
  @ApiParam({ name: 'fileId', description: 'UUID du fichier en base de données' })
  @ApiBody({ schema: { type: 'object', properties: { name: { type: 'string' }, folderId: { type: 'string', nullable: true } } } })
  @ApiResponse({ status: 200, description: 'Fichier mis à jour' })
  @ApiResponse({ status: 403, description: 'Accès refusé' })
  @ApiResponse({ status: 404, description: 'Fichier introuvable' })
  async updateFile(
    @Param('fileId') fileId: string,
    @Req() req: any,
    @Body() body: { name?: string; folderId?: string | null },
  ) {
    const userId = (req.user as any).id;
    await this.cloudStorageService.updateFile(userId, fileId, body);
    return { message: 'Fichier mis à jour' };
  }

  @Get('files/:fileId/shares')
  @ApiOperation({ summary: "Lister les utilisateurs avec qui le fichier est partagé" })
  @ApiParam({ name: 'fileId', description: 'UUID du fichier en base de données' })
  @ApiResponse({ status: 200, description: '{ shares }' })
  @ApiResponse({ status: 403, description: 'Accès refusé' })
  @ApiResponse({ status: 404, description: 'Fichier introuvable' })
  async listFileShares(@Param('fileId') fileId: string, @Req() req: any) {
    const userId = (req.user as any).id;
    const shares = await this.cloudStorageService.listFileShares(userId, fileId);
    return { shares };
  }

  @Post('files/:fileId/shares')
  @ApiOperation({ summary: 'Partager un fichier avec un autre utilisateur' })
  @ApiParam({ name: 'fileId', description: 'UUID du fichier en base de données' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['recipientUserId', 'enc_fek'],
      properties: {
        recipientUserId: { type: 'string' },
        enc_fek: { type: 'string', description: 'FEK chiffrée avec la clé publique du destinataire' },
        read: { type: 'boolean', default: true },
        write: { type: 'boolean', default: false },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Partage créé' })
  @ApiResponse({ status: 403, description: 'Accès refusé' })
  @ApiResponse({ status: 404, description: 'Fichier ou utilisateur introuvable' })
  async shareFile(
    @Param('fileId') fileId: string,
    @Req() req: any,
    @Body() body: { recipientUserId: string; enc_fek: string; read?: boolean; write?: boolean },
  ) {
    const userId = (req.user as any).id;
    const share = await this.cloudStorageService.shareFile(
      userId,
      fileId,
      body.recipientUserId,
      body.enc_fek,
      body.read ?? true,
      body.write ?? false,
    );
    return { share };
  }

  @Delete('files/:fileId/shares/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Révoquer l'accès d'un utilisateur à un fichier" })
  @ApiParam({ name: 'fileId', description: 'UUID du fichier en base de données' })
  @ApiParam({ name: 'userId', description: "UUID de l'utilisateur destinataire" })
  @ApiResponse({ status: 204, description: 'Partage supprimé' })
  async revokeFileShare(
    @Param('fileId') fileId: string,
    @Param('userId') recipientUserId: string,
    @Req() req: any,
  ) {
    const userId = (req.user as any).id;
    await this.cloudStorageService.revokeFileShare(userId, fileId, recipientUserId);
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
