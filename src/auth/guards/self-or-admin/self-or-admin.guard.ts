import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Role } from '../../../generated/prisma/enums';
import type { JwtUser } from '../../strategies/jwt.strategy/jwt.strategy';

@Injectable()
export class SelfOrAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user: JwtUser; params: Record<string, string> }>();
    const user = request.user;
    const targetId = request.params?.id;

    if (!user || !targetId) return false;

    return (user.role as Role) === Role.ADMIN || user.id === targetId;
  }
}
