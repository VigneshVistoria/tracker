import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';

// Multi-tenant conversion Phase E: gates tenant provisioning. Deliberately
// separate from AdminGuard - isPlatformSuperadmin is platform-wide staff
// power (can create new tenants), not a tenant's own admin role, and a
// tenant admin should never automatically get it. Must run AFTER
// JwtAuthGuard. Usage: @UseGuards(JwtAuthGuard, PlatformSuperadminGuard)
@Injectable()
export class PlatformSuperadminGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;

    if (!userId) {
      throw new UnauthorizedException();
    }

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.isPlatformSuperadmin) {
      throw new ForbiddenException('Platform superadmin access required');
    }

    request.currentUser = user;
    return true;
  }
}
