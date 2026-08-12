import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../users/user.entity';

// Must run AFTER JwtAuthGuard (which sets request.user from the token).
// Usage: @UseGuards(JwtAuthGuard, AdminGuard)
@Injectable()
export class AdminGuard implements CanActivate {
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
    if (!user || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }

    request.currentUser = user; // full user record, handy for controllers
    return true;
  }
}
