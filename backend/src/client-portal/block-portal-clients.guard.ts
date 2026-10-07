import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ClientAccessService } from './client-access.service';

// Keeps client-portal users (see ClientAccessService.isPortalClientUser)
// out of internal endpoints that return tenant-wide data - issues,
// sprints, module/project overviews, the staff list. Applied after
// JwtAuthGuard. Does nothing for everyone else, including existing
// client-role users who aren't on a portal-enabled client (e.g. LMS).
@Injectable()
export class BlockPortalClientsGuard implements CanActivate {
  constructor(private clientAccess: ClientAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest().user;
    if (!user?.sub) return true; // JwtAuthGuard already rejects these
    if (await this.clientAccess.isPortalClientUser(user.sub, user.tenantId)) {
      throw new ForbiddenException('Not available in the client portal.');
    }
    return true;
  }
}
