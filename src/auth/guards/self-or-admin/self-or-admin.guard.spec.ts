import { ExecutionContext } from '@nestjs/common';
import { Role } from '../../../generated/prisma/enums';
import { SelfOrAdminGuard } from './self-or-admin.guard';

const makeContext = (user: any, id: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user, params: { id } }) }),
  }) as unknown as ExecutionContext;

describe('SelfOrAdminGuard', () => {
  let guard: SelfOrAdminGuard;

  beforeEach(() => {
    guard = new SelfOrAdminGuard();
  });

  it("autorise un utilisateur accédant à sa propre ressource", () => {
    const user = { id: 'uuid-1', role: Role.USER };
    expect(guard.canActivate(makeContext(user, 'uuid-1'))).toBe(true);
  });

  it("autorise un admin accédant à n'importe quelle ressource", () => {
    const user = { id: 'uuid-admin', role: Role.ADMIN };
    expect(guard.canActivate(makeContext(user, 'uuid-other'))).toBe(true);
  });

  it("refuse un utilisateur accédant à la ressource d'un autre", () => {
    const user = { id: 'uuid-1', role: Role.USER };
    expect(guard.canActivate(makeContext(user, 'uuid-2'))).toBe(false);
  });

  it('refuse si user absent', () => {
    expect(guard.canActivate(makeContext(undefined, 'uuid-1'))).toBe(false);
  });

  it('refuse si targetId absent', () => {
    const user = { id: 'uuid-1', role: Role.USER };
    expect(guard.canActivate(makeContext(user, undefined as any))).toBe(false);
  });
});
