import { Body, Controller, Get, Post, Headers, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { TenantsService } from '../tenants/tenants.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private tenantsService: TenantsService,
  ) {}

  // Public and unauthenticated on purpose - it only reveals a boolean, so
  // the register page can tell a visitor up front whether the form will
  // actually work rather than let them fill it out and hit a 403.
  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 20, ttl: 60000 } }) @Get('registration-status')
  async registrationStatus(@Headers('host') host: string) {
    const tenant = await this.tenantsService.resolveFromHost(host);
    return { open: await this.authService.isRegistrationOpen(tenant.id) };
  }

  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('register')
  async register(@Body() dto: RegisterDto, @Headers('host') host: string) {
    const tenant = await this.tenantsService.resolveFromHost(host);
    return this.authService.register(dto, tenant.id);
  }

  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Headers('host') host: string) {
    const tenant = await this.tenantsService.resolveFromHost(host);
    return this.authService.login(dto, tenant.id);
  }
}
