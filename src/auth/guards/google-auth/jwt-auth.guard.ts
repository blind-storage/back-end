import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Login Google uniquement (scopes email/profile). L'accès Drive (offline + scopes
// de stockage) est demandé séparément par le flux de connexion du module cloud-storage.
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {}
