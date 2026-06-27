import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class RezelAuthGuard extends AuthGuard('rezel') {}
