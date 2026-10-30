import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { UsersService } from '../../users/users.service';
import { ScorecardService } from './scorecard.service';
import { CreateScoreOverrideDto, RemoveScoreOverrideDto } from '../dto/scorecard.dto';

const dateOf = (date: string | undefined) => {
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD.');
  return date;
};

// Performance Tracking B3 - the scorecard. Who sees what is decided in
// ScorecardService (PM/Executive/Admin everyone; developer, designer and
// DevOps only their own; nobody else), never by the screen alone.
@Controller('performance-tracking/scorecard')
@UseGuards(JwtAuthGuard)
export class ScorecardController {
  constructor(
    private scorecard: ScorecardService,
    private usersService: UsersService,
  ) {}

  private async me(req: any) {
    const user = await this.usersService.findById(req.user.sub);
    if (!user || user.tenantId !== req.user.tenantId) throw new BadRequestException('Unknown user.');
    return user;
  }

  // Whether to show the developer's top-bar link (any project tracked).
  @Get('visible')
  async visible(@Req() req: any) {
    await this.me(req);
    return { visible: await this.scorecard.anyTracking(req.user.tenantId) };
  }

  @Get()
  async list(@Query('date') date: string | undefined, @Req() req: any) {
    return this.scorecard.list(await this.me(req), dateOf(date));
  }

  // PM and Admin only; audited.
  @Get('export')
  async export(@Query('date') date: string | undefined, @Req() req: any, @Res() res: Response) {
    const { buffer, filename } = await this.scorecard.exportExcel(await this.me(req), dateOf(date));
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  }

  @Get('people/:userId')
  async person(@Param('userId', ParseIntPipe) userId: number, @Query('date') date: string | undefined, @Req() req: any) {
    return this.scorecard.person(await this.me(req), userId, dateOf(date));
  }

  @Post('overrides')
  async setOverride(@Body() dto: CreateScoreOverrideDto, @Req() req: any) {
    return this.scorecard.setOverride(await this.me(req), dto);
  }

  @Patch('overrides/:id/remove')
  async removeOverride(@Param('id', ParseIntPipe) id: number, @Body() dto: RemoveScoreOverrideDto, @Req() req: any) {
    return this.scorecard.removeOverride(await this.me(req), id, dto);
  }
}
