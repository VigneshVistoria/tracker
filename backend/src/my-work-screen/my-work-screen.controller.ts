import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { MyWorkScreenService } from './my-work-screen.service';
import { SaveMyWorkScreenDto } from './dto/my-work-screen.dto';

// "New My work screen" setting - see ./my-work-screen.ts.
@Controller('my-work-screen')
@UseGuards(JwtAuthGuard)
export class MyWorkScreenController {
  constructor(
    private myWorkScreen: MyWorkScreenService,
    private usersService: UsersService,
  ) {}

  private async me(req: any) {
    return (await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId))!;
  }

  @Get('me')
  async forMe(@Req() req: any) {
    return this.myWorkScreen.forMe(await this.me(req), req.user.tenantId);
  }

  // Admin / Program Manager only (checked in the service), audited.
  @Get('settings')
  async settings(@Req() req: any) {
    return this.myWorkScreen.settingsPage(await this.me(req), req.user.tenantId);
  }

  @Put('settings')
  async save(@Body() dto: SaveMyWorkScreenDto, @Req() req: any) {
    return this.myWorkScreen.save(dto, await this.me(req), req.user.tenantId);
  }
}
