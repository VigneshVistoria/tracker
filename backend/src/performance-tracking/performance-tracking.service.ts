import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { UserRole } from '../users/user.entity';
import { PerformanceTrackingSettings } from './performance-tracking-settings.entity';
import { TaskStatusEvent } from './task-status-event.entity';
import {
  PERFORMANCE_TRACKING_AUDIT,
  PERFORMANCE_TRACKING_DEFAULTS,
  PerformanceTrackingThresholds,
  projectTrackingPhase,
} from './performance-tracking';
import { UpdatePerformanceTrackingSettingsDto } from './dto/performance-tracking.dto';

type Actor = { id: number; email: string; role: UserRole };

// Performance Tracking S1 - see ./performance-tracking.ts.
@Injectable()
export class PerformanceTrackingService {
  constructor(
    @InjectRepository(Project) private readonly projectsRepository: Repository<Project>,
    @InjectRepository(PerformanceTrackingSettings) private readonly settingsRepository: Repository<PerformanceTrackingSettings>,
    @InjectRepository(TaskStatusEvent) private readonly statusEventsRepository: Repository<TaskStatusEvent>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async thresholds(tenantId: number): Promise<PerformanceTrackingThresholds> {
    const row = await this.settingsRepository.findOne({ where: { tenantId } });
    if (!row) return { ...PERFORMANCE_TRACKING_DEFAULTS };
    return {
      baselineDays: row.baselineDays,
      notReadyDeclaredDependencyExempt: row.notReadyDeclaredDependencyExempt,
      earlyWarningWorkingDays: row.earlyWarningWorkingDays,
      dateMovesFlagCount: row.dateMovesFlagCount,
      statusFreshWorkingDays: row.statusFreshWorkingDays,
      chasesPerTasks: row.chasesPerTasks,
      reopenWindowDays: row.reopenWindowDays,
    };
  }

  // The settings page: thresholds, and every project's switch and phase.
  async settingsPage(tenantId: number, now = new Date()) {
    const [settings, row, projects] = await Promise.all([
      this.thresholds(tenantId),
      this.settingsRepository.findOne({ where: { tenantId } }),
      this.projectsRepository.find({ where: { tenantId }, order: { name: 'ASC' } }),
    ]);
    return {
      settings,
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        performanceTrackingEnabled: !!p.performanceTrackingEnabled,
        performanceTrackingSince: p.performanceTrackingSince ?? null,
        ...projectTrackingPhase(!!p.performanceTrackingEnabled, p.performanceTrackingSince ?? null, now, settings.baselineDays),
      })),
    };
  }

  async saveSettings(dto: UpdatePerformanceTrackingSettingsDto, actor: Actor, tenantId: number) {
    const before = await this.thresholds(tenantId);
    const after: PerformanceTrackingThresholds = { ...before };
    for (const key of Object.keys(PERFORMANCE_TRACKING_DEFAULTS) as (keyof PerformanceTrackingThresholds)[]) {
      if (dto[key] !== undefined) (after as any)[key] = dto[key];
    }
    await this.settingsRepository.save(this.settingsRepository.create({ tenantId, ...after, updatedByUserId: actor.id }));
    await this.auditLogService.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: PERFORMANCE_TRACKING_AUDIT.SETTINGS_UPDATED,
      tenantId,
      entityType: 'PerformanceTrackingSettings',
      entityId: tenantId,
      details: { before, after },
    });
    return this.settingsPage(tenantId);
  }

  // performanceTrackingSince is set the first time a project is switched
  // on and never changed after - it is the project's go-live date.
  async setProjectSwitch(projectId: number, enabled: boolean, actor: Actor, tenantId: number) {
    const project = await this.projectsRepository.findOne({ where: { id: projectId, tenantId } });
    if (!project) throw new NotFoundException(`Project #${projectId} not found`);
    const since = project.performanceTrackingSince ?? (enabled ? new Date() : null);
    await this.projectsRepository.update({ id: projectId, tenantId }, { performanceTrackingEnabled: enabled, performanceTrackingSince: since });
    await this.auditLogService.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: PERFORMANCE_TRACKING_AUDIT.PROJECT_SWITCHED,
      tenantId,
      entityType: 'Project',
      entityId: projectId,
      details: { from: !!project.performanceTrackingEnabled, to: enabled, since },
    });
    return { projectId, performanceTrackingEnabled: enabled, performanceTrackingSince: since };
  }

  // A task's status history, oldest first (used by later stages).
  statusEvents(taskId: number, tenantId: number): Promise<TaskStatusEvent[]> {
    return this.statusEventsRepository.find({ where: { taskId, tenantId }, order: { occurredAt: 'ASC', id: 'ASC' } });
  }
}
