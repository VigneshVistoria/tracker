import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { UserRole } from '../users/user.entity';
import { PerformanceTrackingSettings } from './performance-tracking-settings.entity';

// Who may see performance figures (2026-11-11, the user's instruction).
//  * Admin, Program Manager, Executive: as before (everyone's figures where
//    they already could).
//  * Developer, Designer, DevOps, QA: NOTHING - not even their own - unless
//    an Admin ticks their role in "Show own performance metrics to team
//    members" (default: no role). Even then, only their own.
//  * Anyone else (e.g. client): never.
// Only visibility - everything keeps being recorded.
export const WIDE_METRICS_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE];
export const OWN_METRICS_ROLE_CHOICES: UserRole[] = [UserRole.DEVELOPER, UserRole.DESIGNER, UserRole.DEVOPS, UserRole.QA];
export const OWN_METRICS_AUDIT = 'own_metrics_visibility_updated';
export const OWN_METRICS_REFUSAL = 'Performance figures are not shown to your role.';

type Actor = { id: number; email: string; role: UserRole };

@Injectable()
export class OwnMetricsVisibilityService {
  constructor(
    @InjectRepository(PerformanceTrackingSettings) private readonly settingsRepo: Repository<PerformanceTrackingSettings>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async roles(tenantId: number): Promise<UserRole[]> {
    const row = await this.settingsRepo.findOne({ where: { tenantId } });
    return (row?.ownMetricsRoles ?? []).filter((r) => OWN_METRICS_ROLE_CHOICES.includes(r));
  }

  // May this user see their OWN figures? (Wide roles: yes, as before.)
  async canSeeOwn(user: { role: UserRole }, tenantId: number): Promise<boolean> {
    if (WIDE_METRICS_ROLES.includes(user.role)) return true;
    if (!OWN_METRICS_ROLE_CHOICES.includes(user.role)) return false;
    return (await this.roles(tenantId)).includes(user.role);
  }

  async save(roles: unknown, actor: Actor, tenantId: number) {
    if (!Array.isArray(roles) || roles.some((r) => !OWN_METRICS_ROLE_CHOICES.includes(r as UserRole))) {
      throw new BadRequestException(`Roles must be from: ${OWN_METRICS_ROLE_CHOICES.join(', ')}.`);
    }
    const after = [...new Set(roles as UserRole[])];
    const before = await this.roles(tenantId);
    const existing = await this.settingsRepo.findOne({ where: { tenantId } });
    if (existing) await this.settingsRepo.update({ tenantId }, { ownMetricsRoles: after, updatedByUserId: actor.id } as any);
    else await this.settingsRepo.insert({ tenantId, ownMetricsRoles: after, updatedByUserId: actor.id } as any);
    await this.auditLogService.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: OWN_METRICS_AUDIT,
      tenantId,
      entityType: 'PerformanceTrackingSettings',
      entityId: tenantId,
      details: { before, after },
    });
    return { roles: after, choices: OWN_METRICS_ROLE_CHOICES };
  }
}
