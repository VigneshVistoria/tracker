import { Controller, Get, Patch, Body, UseGuards, Req } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { UpdateKpiConfigDto } from './dto/update-kpi-config.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';

// Admin-only end to end, per spec - same shape as SlaController/
// PerformanceScoringController. Changes here only ever affect KPI period
// rows generated afterward - already-frozen rows are untouched (see
// KpiPeriodScore's class comment).
@Controller('kpi-config')
@UseGuards(JwtAuthGuard, AdminGuard)
export class KpiConfigController {
  constructor(private kpiService: KpiService) {}

  @Get()
  getConfig(@Req() req: any) {
    return this.kpiService.getConfig(req.user.tenantId);
  }

  @Patch()
  updateConfig(@Body() dto: UpdateKpiConfigDto, @Req() req: any) {
    return this.kpiService.updateConfig(dto, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }
}
