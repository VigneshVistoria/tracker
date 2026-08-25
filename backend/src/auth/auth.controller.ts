import { Body, Controller, Get, Post, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Public and unauthenticated on purpose - it only reveals a boolean, so
  // the register page can tell a visitor up front whether the form will
  // actually work rather than let them fill it out and hit a 403.
  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 20, ttl: 60000 } }) @Get('registration-status')
  async registrationStatus() {
    return { open: await this.authService.isRegistrationOpen() };
  }

  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
