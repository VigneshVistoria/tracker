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

  async register(dto: RegisterDto) { const userCount = await this.usersService.count(); if (userCount > 0) { throw new ForbiddenException('Public registration is disabled. Ask an admin to create your account.'); }
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    // The very first person to register on a fresh install becomes admin
    // automatically, so there's always someone who can manage users/projects.
    const isFirstUser = (await this.usersService.count()) === 0;
    const role = isFirstUser ? UserRole.ADMIN : UserRole.DEVELOPER;

    const user = await this.usersService.create(dto.email, passwordHash, dto.fullName, role);

    return this.buildAuthResponse(user.id, user.email, user.fullName, user.role);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      // Same error for "no user" and "wrong password" so we don't leak
      // which emails are registered.
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.buildAuthResponse(user.id, user.email, user.fullName, user.role);
  }

  private buildAuthResponse(id: number, email: string, fullName: string, role: UserRole) {
    const payload = { sub: id, email };
    const accessToken = this.jwtService.sign(payload);
    return {
      accessToken,
      user: { id, email, fullName, role },
    };
  }
}
