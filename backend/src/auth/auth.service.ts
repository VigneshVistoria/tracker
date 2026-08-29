import {
  Injectable, ForbiddenException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  // Exposed via a public endpoint so the frontend can hide/disable the
  // registration form instead of letting someone fill it out and only
  // find out it's blocked after submitting. Scoped per tenant - a fresh
  // tenant with no users yet has registration open even if other
  // tenants already have users.
  async isRegistrationOpen(tenantId: number): Promise<boolean> {
    return (await this.usersService.countByTenant(tenantId)) === 0;
  }

  async register(dto: RegisterDto, tenantId: number) {
    const userCount = await this.usersService.countByTenant(tenantId);
    if (userCount > 0) {
      throw new ForbiddenException('Public registration is disabled. Ask an admin to create your account.');
    }

    const existing = await this.usersService.findByEmailAndTenant(dto.email, tenantId);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    // The very first person to register for a tenant becomes that
    // tenant's admin automatically, so there's always someone who can
    // manage users/projects within it.
    const role = userCount === 0 ? UserRole.ADMIN : UserRole.DEVELOPER;

    const user = await this.usersService.create(dto.email, passwordHash, tenantId, dto.fullName, role);

    return this.buildAuthResponse(user.id, user.email, user.fullName, user.role, tenantId);
  }

  async login(dto: LoginDto, tenantId: number) {
    const user = await this.usersService.findByEmailAndTenant(dto.email, tenantId);
    if (!user) {
      // Same error for "no user" and "wrong password" so we don't leak
      // which emails are registered.
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.buildAuthResponse(user.id, user.email, user.fullName, user.role, tenantId);
  }

  private buildAuthResponse(id: number, email: string, fullName: string, role: UserRole, tenantId: number) {
    const payload = { sub: id, email, tenantId };
    const accessToken = this.jwtService.sign(payload);
    return {
      accessToken,
      user: { id, email, fullName, role },
    };
  }
}
