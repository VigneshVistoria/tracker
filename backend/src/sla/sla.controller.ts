import { Controller, Get, Patch, Body, Param, UseGuards, Req } from '@nestjs/common';
import { SlaService } from './sla.service';
import { SlaTargetKey } from './sla-config.entity';
import { UpdateSlaConfigDto } from './dto/update-sla-config.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';

// Admin-only end to end, per spec - the config page itself, and the API
// behind it, both require AdminGuard. (Individual issues' resolved SLA
// info is exposed separately via the issue endpoints, not here - this
// controller is just the target configuration.)
@Controller('sla-config')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SlaController {
  constructor(private slaService: SlaService) {}

  @Get()
  getConfig() {
    return this.slaService.getConfig();
  }

  @Patch(':key')
  update(@Param('key') key: SlaTargetKey, @Body() dto: UpdateSlaConfigDto, @Req() req: any) {
    return this.slaService.updateTarget(key, dto.targetHours, { id: req.user.sub, email: req.user.email });
  }
}
