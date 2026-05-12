import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class DropboxAuthGuard extends AuthGuard('dropbox') {}
