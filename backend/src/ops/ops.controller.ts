import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { OpsService } from './ops.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { RollbackDto } from './dto/rollback.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';

// Admin-only end to end, per spec - the Rollback UI page and the API
// behind it both require AdminGuard.
@Controller('ops')
@UseGuards(JwtAuthGuard, AdminGuard)
export class OpsController {
  constructor(
    private opsService: OpsService,
    private auditLogService: AuditLogService,
  ) {}

  @Get('releases')
  listReleases() {
    return this.opsService.listReleases();
  }

  // Fire-and-poll, not fire-and-await: rollback.sh restarts tracker-backend
  // itself, which would kill a synchronous handler mid-flight before it
  // could ever respond. This kicks the rollback off in the background and
  // returns immediately; the frontend polls GET /ops/rollback/status.
  @Post('rollback')
  async rollback(@Body() dto: RollbackDto, @Req() req: any) {
    const result = this.opsService.startRollback(dto.releaseId, dto.confirmText, req.user.email);

    await this.auditLogService.record({
      userId: req.user.sub,
      userEmail: req.user.email,
      userRole: req.currentUser?.role ?? null,
      action: AuditActions.ROLLBACK_TRIGGERED,
      tenantId: req.user.tenantId,
      entityType: 'Release',
      details: { releaseId: dto.releaseId, phase: 'started' },
    });

    return result;
  }

  @Get('rollback/status')
  async rollbackStatus(@Req() req: any) {
    const status = this.opsService.getStatus();

    if (status.shouldAuditLog) {
      await this.auditLogService.record({
        userId: req.user.sub,
        userEmail: req.user.email,
        userRole: req.currentUser?.role ?? null,
        action: AuditActions.ROLLBACK_TRIGGERED,
        tenantId: req.user.tenantId,
        entityType: 'Release',
        details: {
          releaseId: status.targetId,
          phase: 'completed',
          status: status.status,
          smokeCheckPassed: status.smokeCheckPassed,
          reason: status.reason,
        },
      });
    }

    return status;
  }
}
