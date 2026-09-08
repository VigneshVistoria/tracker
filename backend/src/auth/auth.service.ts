import {
  Injectable, ForbiddenException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

const SALT_ROUNDS = 10;

// Impersonation tokens are deliberately shorter-lived than a normal login
// session (see JWT_EXPIRES_IN in guards.module.ts) - if one leaks, the
// window it's useful in is small.
const IMPERSONATION_EXPIRES_IN = '30m';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private auditLogService: AuditLogService,
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

    return this.buildAuthResponse(user, tenantId);
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

    return this.buildAuthResponse(user, tenantId);
  }

  // Lets an Admin temporarily act as another user in their own tenant, for
  // debugging/support, without needing that user's password. Deliberately
  // refuses to target another Admin or a platform superadmin - keeps the
  // blast radius of a compromised admin session limited to the non-admin
  // roles support actually needs to reproduce issues for.
  async impersonate(admin: User, targetUserId: number, tenantId: number) {
    if (targetUserId === admin.id) {
      throw new ForbiddenException('You are already signed in as yourself');
    }

    const target = await this.usersService.findByIdAndTenant(targetUserId, tenantId);
    if (!target) {
      throw new NotFoundException(`User #${targetUserId} not found`);
    }
    if (target.role === UserRole.ADMIN || target.isPlatformSuperadmin) {
      throw new ForbiddenException('Cannot impersonate another admin');
    }

    const payload = {
      sub: target.id,
      email: target.email,
      tenantId,
      impersonatorId: admin.id,
      impersonatorEmail: admin.email,
    };
    const accessToken = this.jwtService.sign(payload, { expiresIn: IMPERSONATION_EXPIRES_IN });

    await this.auditLogService.record({
      userId: admin.id,
      userEmail: admin.email,
      userRole: admin.role,
      action: AuditActions.IMPERSONATION_STARTED,
      entityType: 'user',
      entityId: target.id,
      details: { targetEmail: target.email, targetRole: target.role },
      tenantId,
    });

    return {
      accessToken,
      user: this.toPublicUser(target),
      impersonator: { id: admin.id, email: admin.email, fullName: admin.fullName },
    };
  }

  // Ends an impersonation session and hands back a normal token for the
  // original admin. Only usable while an impersonation token (one carrying
  // impersonatorId) is presented - a normal session has nothing to "exit".
  async exitImpersonation(payload: { sub: number; impersonatorId?: number; tenantId: number }) {
    if (!payload.impersonatorId) {
      throw new ForbiddenException('Not currently impersonating anyone');
    }

    const admin = await this.usersService.findByIdAndTenant(payload.impersonatorId, payload.tenantId);
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new UnauthorizedException('Impersonating admin account is no longer valid');
    }

    await this.auditLogService.record({
      userId: admin.id,
      userEmail: admin.email,
      userRole: admin.role,
      action: AuditActions.IMPERSONATION_ENDED,
      entityType: 'user',
      entityId: payload.sub,
      tenantId: payload.tenantId,
    });

    return this.buildAuthResponse(admin, payload.tenantId);
  }

  private toPublicUser(user: { id: number; email: string; fullName: string; role: UserRole; isPlatformSuperadmin: boolean }) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isPlatformSuperadmin: user.isPlatformSuperadmin,
    };
  }

  private buildAuthResponse(
    user: { id: number; email: string; fullName: string; role: UserRole; isPlatformSuperadmin: boolean },
    tenantId: number,
  ) {
    const payload = { sub: user.id, email: user.email, tenantId };
    const accessToken = this.jwtService.sign(payload);
    return {
      accessToken,
      user: this.toPublicUser(user),
    };
  }
}
