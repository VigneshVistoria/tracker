import { Controller, Get, Post, Param, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { RegressionTestingService } from './regression-testing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';

// Admin-only: regression testing can create/modify real database rows
// (cleaned up automatically) and isn't something regular users need to
// trigger or see.
@Controller('regression-testing')
@UseGuards(JwtAuthGuard, AdminGuard)
export class RegressionTestingController {
  constructor(private regressionTestingService: RegressionTestingService) {}

  // Runs synchronously and returns the full result - the whole suite
  // takes well under a second, so there's no need for polling/job status.
  @Post('run')
  run(@Req() req: any) {
    const { sub: userId, email, tenantId } = req.user;
    return this.regressionTestingService.run(userId, email, tenantId);
  }

  @Get('runs')
  findHistory(@Req() req: any) {
    return this.regressionTestingService.findHistory(req.user.tenantId);
  }

  @Get('runs/:id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.regressionTestingService.findOne(id, req.user.tenantId);
  }
}
