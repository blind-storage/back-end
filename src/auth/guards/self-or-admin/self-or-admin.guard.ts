import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Role } from '@blind-storage/types';
import type { JwtUser } from '@blind-storage/types';

@Injectable()
export class SelfOrAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user: JwtUser; params: Record<string, string> }>();
    const user = request.user;
    const targetId = request.params?.id;

    if (!user || !targetId) return false;

    return user.role === Role.ADMIN || user.id === targetId;
  }
}
