import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { WorkCalendarService } from './work-calendar.service';
import { AddCountryHolidayDto, AddLeaveDto, SetPersonCalendarDto } from './dto/work-calendar.dto';

// B4 - per-person working calendar, leave and country holidays. Admin and
// Program Manager only (checked in the service).
@Controller('work-calendars')
@UseGuards(JwtAuthGuard)
export class WorkCalendarController {
  constructor(
    private calendars: WorkCalendarService,
    private usersService: UsersService,
  ) {}

  private me(req: any) {
    return this.usersService.findById(req.user.sub).then((u) => u!);
  }

  @Get()
  async page(@Req() req: any) {
    return this.calendars.page(await this.me(req));
  }

  @Patch('people/:userId')
  async set(@Param('userId', ParseIntPipe) userId: number, @Body() dto: SetPersonCalendarDto, @Req() req: any) {
    return this.calendars.setCalendar(await this.me(req), userId, dto);
  }

  @Delete('people/:userId')
  async reset(@Param('userId', ParseIntPipe) userId: number, @Req() req: any) {
    return this.calendars.resetCalendar(await this.me(req), userId);
  }

  @Post('leave')
  async addLeave(@Body() dto: AddLeaveDto, @Req() req: any) {
    return this.calendars.addLeave(await this.me(req), dto);
  }

  @Patch('leave/:id/remove')
  async removeLeave(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.calendars.removeLeave(await this.me(req), id);
  }

  @Post('holidays')
  async addHoliday(@Body() dto: AddCountryHolidayDto, @Req() req: any) {
    return this.calendars.addHoliday(await this.me(req), dto);
  }

  @Delete('holidays/:id')
  async removeHoliday(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.calendars.removeHoliday(await this.me(req), id);
  }
}
