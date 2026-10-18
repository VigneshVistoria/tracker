import { Body, Controller, Get, Post, Param, ParseIntPipe, Headers, HttpCode, HttpStatus, Req, Res, UseGuards, ForbiddenException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { TenantsService } from '../tenants/tenants.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RealIpThrottlerGuard } from './real-ip-throttler.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';
import { SessionService, REFRESH_COOKIE, readCookie } from './session.service';

// The web app sends "X-Client: web" on sign-in and session calls; anything
// else (the mobile app, scripts) keeps the plain 1-day Bearer token. The
// custom header also means a cross-site form or link can never trigger the
// cookie endpoints - browsers only send it after a CORS preflight, which
// only the app's own origin passes.
const isWeb = (req: any) => req.headers['x-client'] === 'web';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private tenantsService: TenantsService,
    private sessionService: SessionService,
  ) {}

  private setRefreshCookie(res: Response, refreshToken: string, maxAgeMs: number) {
    res.cookie(REFRESH_COOKIE, refreshToken, this.sessionService.cookieOptions(maxAgeMs));
  }

  private clearRefreshCookie(res: Response) {
    const { maxAge, ...options } = this.sessionService.cookieOptions(0);
    res.clearCookie(REFRESH_COOKIE, options);
  }

  // Login/register for the web app: swap the 1-day token for a short one
  // plus the refresh cookie.
  private async asWebSession(body: { accessToken: string; user: { id: number; email: string } }, tenantId: number, req: any, res: Response) {
    if (!isWeb(req)) return body;
    const web = await this.authService.startWebSession(body.user, tenantId, req.headers['user-agent']);
    this.setRefreshCookie(res, web.refreshToken, web.cookieMaxAgeMs);
    return { ...body, accessToken: web.accessToken };
  }

  private requireWeb(req: any) {
    if (!isWeb(req)) throw new ForbiddenException('Web client header required');
  }

  // Public and unauthenticated on purpose - it only reveals a boolean, so
  // the register page can tell a visitor up front whether the form will
  // actually work rather than let them fill it out and hit a 403.
  @UseGuards(RealIpThrottlerGuard) @Throttle({ default: { limit: 20, ttl: 60000 } }) @Get('registration-status')
  async registrationStatus(@Headers('host') host: string) {
    const tenant = await this.tenantsService.resolveFromHost(host);
    return { open: await this.authService.isRegistrationOpen(tenant.id) };
  }

  @UseGuards(RealIpThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('register')
  async register(@Body() dto: RegisterDto, @Headers('host') host: string, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const tenant = await this.tenantsService.resolveFromHost(host);
    return this.asWebSession(await this.authService.register(dto, tenant.id), tenant.id, req, res);
  }

  @UseGuards(RealIpThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Headers('host') host: string, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const tenant = await this.tenantsService.resolveFromHost(host);
    return this.asWebSession(await this.authService.login(dto, tenant.id), tenant.id, req, res);
  }

  // Web only: a new short access token from the refresh cookie (the cookie
  // is swapped for a new one each time). 401 = signed out for real.
  @UseGuards(RealIpThrottlerGuard) @Throttle({ default: { limit: 60, ttl: 60000 } }) @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Headers('host') host: string, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    this.requireWeb(req);
    const tenant = await this.tenantsService.resolveFromHost(host);
    try {
      const { refreshToken, cookieMaxAgeMs, ...body } = await this.authService.refresh(readCookie(req.headers.cookie, REFRESH_COOKIE), tenant.id);
      if (refreshToken) this.setRefreshCookie(res, refreshToken, cookieMaxAgeMs);
      return body;
    } catch (err) {
      this.clearRefreshCookie(res);
      throw err;
    }
  }

  // Ends the web session on the server too (not just in the browser).
  // Needs no access token - it may already have expired.
  @UseGuards(RealIpThrottlerGuard) @Throttle({ default: { limit: 30, ttl: 60000 } }) @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    this.requireWeb(req);
    await this.authService.logout(readCookie(req.headers.cookie, REFRESH_COOKIE));
    this.clearRefreshCookie(res);
  }

  // One-time swap of a pre-session (1-day) web token for a web session -
  // only until SESSION_UPGRADE_UNTIL, see AuthService.upgradeLegacySession.
  @UseGuards(RealIpThrottlerGuard, JwtAuthGuard) @Throttle({ default: { limit: 10, ttl: 60000 } }) @Post('session-upgrade')
  @HttpCode(HttpStatus.OK)
  async sessionUpgrade(@Headers('host') host: string, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    this.requireWeb(req);
    const tenant = await this.tenantsService.resolveFromHost(host);
    const { refreshToken, cookieMaxAgeMs, ...body } = await this.authService.upgradeLegacySession(req.user, tenant.id, req.headers['user-agent']);
    this.setRefreshCookie(res, refreshToken, cookieMaxAgeMs);
    return body;
  }

  // Admin-only: mints a short-lived token for the target user so the admin
  // can view/act in the app as them without their password. AdminGuard
  // attaches the full admin record as req.currentUser. The admin's own
  // refresh cookie is left alone, so their session resumes afterwards.
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
    const body = await this.authService.exitImpersonation(req.user);
    // A web admin with a session goes back to a short token; one without
    // (signed in before web sessions) keeps the long one.
    if (isWeb(req) && readCookie(req.headers.cookie, REFRESH_COOKIE)) {
      return { ...body, accessToken: this.authService.signWebAccessToken(body.user, req.user.tenantId) };
    }
    return body;
  }
}
