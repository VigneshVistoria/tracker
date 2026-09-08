import { Body, Controller, Get, Post, Param, ParseIntPipe, Headers, HttpCode, HttpStatus, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { TenantsService } from '../tenants/tenants.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RealIpThrottlerGuard } from './real-ip-throttler.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private tenantsService: TenantsService,
  ) {}

  // Public and unauthenticated on purpose - it only reveals a boolean, so
  // the register page can tell a visitor up front whether the form will
  // actually work rather than let them fill it out and hit a 403.
  @UseGuards(RealIpThrottlerGuard) @Throttle({ default: { limit: 20, ttl: 60000 } }) @Get('registration-status')
  async registrationStatus(@Headers('host') host: string) {
    const tenant = await this.tenantsService.resolveFromHost(host);
    return { open: await this.authService.isRegistrationOpen(tenant.id) };
  }

  @UseGuards(RealIpThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('register')
  async register(@Body() dto: RegisterDto, @Headers('host') host: string) {
    const tenant = await this.tenantsService.resolveFromHost(host);
    return this.authService.register(dto, tenant.id);
  }

  @UseGuards(RealIpThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Headers('host') host: string) {
    const tenant = await this.tenantsService.resolveFromHost(host);
    return this.authService.login(dto, tenant.id);
  }

  // Admin-only: mints a short-lived token for the target user so the admin
  // can view/act in the app as them without their password. AdminGuard
  // attaches the full admin record as req.currentUser.
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('impersonate/:userId')
  async impersonate(@Param('userId', ParseIntPipe) userId: number, @Req() req: any) {
    return this.authService.impersonate(req.currentUser, userId, req.currentUser.tenantId);
  }

  // No AdminGuard here on purpose - while impersonating, the token's role
  // is the impersonated (often non-admin) user's, so AdminGuard would
  // reject the very request meant to end the impersonation.
  @UseGuards(JwtAuthGuard)
  @Post('exit-impersonation')
  @HttpCode(HttpStatus.OK)
  async exitImpersonation(@Req() req: any) {
    return this.authService.exitImpersonation(req.user);
  }
}
