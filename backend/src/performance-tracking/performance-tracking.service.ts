import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { User, UserRole } from '../users/user.entity';
import { PerformanceTrackingSettings } from './performance-tracking-settings.entity';
import { TaskStatusEvent } from './task-status-event.entity';
import {
  BLOCKER_LAG_CLOCK_STARTS,
  CHASE_ROLE_CHOICES,
  NON_COMPLIANCE_DISPLAYS,
  OVERRIDE_USER_ROLES,
  calendarProblem,
  HHMM,
  REQUEST_SOURCES,
  THRESHOLD_LIMITS,
  PERFORMANCE_TRACKING_AUDIT,
  PERFORMANCE_TRACKING_DEFAULTS,
  PerformanceTrackingThresholds,
  bandProblem,
  projectTrackingPhase,
} from './performance-tracking';
import { UpdatePerformanceTrackingSettingsDto } from './dto/performance-tracking.dto';
import { criteriaProblem } from '../tech-reviews/tech-reviews';
import { codeFor, reasonsProblem } from '../task-qa-reviews/escalation-reasons';
import { SECURITY_ROLE_CHOICES, SlaDays, slaDaysProblem } from '../security-findings/security-findings';
import { questionsProblem, tiersProblem } from '../client-measures/client-measures';

type Actor = { id: number; email: string; role: UserRole };

// Performance Tracking S1 - see ./performance-tracking.ts.
@Injectable()
export class PerformanceTrackingService {
  constructor(
    @InjectRepository(Project) private readonly projectsRepository: Repository<Project>,
    @InjectRepository(PerformanceTrackingSettings) private readonly settingsRepository: Repository<PerformanceTrackingSettings>,
    @InjectRepository(TaskStatusEvent) private readonly statusEventsRepository: Repository<TaskStatusEvent>,
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async thresholds(tenantId: number): Promise<PerformanceTrackingThresholds> {
    const row = await this.settingsRepository.findOne({ where: { tenantId } });
    if (!row) return { ...PERFORMANCE_TRACKING_DEFAULTS };
    const out = { ...PERFORMANCE_TRACKING_DEFAULTS };
    for (const key of Object.keys(PERFORMANCE_TRACKING_DEFAULTS) as (keyof PerformanceTrackingThresholds)[]) {
      if ((row as any)[key] !== undefined && (row as any)[key] !== null) (out as any)[key] = (row as any)[key];
    }
    if (!Array.isArray(out.escalationReasons) || out.escalationReasons.length === 0) out.escalationReasons = PERFORMANCE_TRACKING_DEFAULTS.escalationReasons.map((r) => ({ ...r }));
    return out;
  }

  // The settings page: thresholds, and every project's switch and phase.
  async settingsPage(tenantId: number, now = new Date()) {
    const [settings, row, projects, leaders] = await Promise.all([
      this.thresholds(tenantId),
      this.settingsRepository.findOne({ where: { tenantId } }),
      this.projectsRepository.find({ where: { tenantId }, order: { name: 'ASC' } }),
      this.usersRepository.find({ where: { tenantId, role: In(OVERRIDE_USER_ROLES) }, order: { fullName: 'ASC' } }),
    ]);
    return {
      settings,
      choices: {
        blockerLagClockStart: BLOCKER_LAG_CLOCK_STARTS,
        nonComplianceDisplay: NON_COMPLIANCE_DISPLAYS,
        requestSources: REQUEST_SOURCES,
        chaseRoles: CHASE_ROLE_CHOICES,
        securityRoles: SECURITY_ROLE_CHOICES,
        // B4: the people who can be named as override users.
        overrideUsers: leaders.map((u) => ({ id: u.id, name: u.fullName || u.email, role: u.role })),
      },
      limits: THRESHOLD_LIMITS,
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
    for (const kind of ['percentBands', 'breachBands'] as const) {
      const problem = bandProblem(kind, after[kind]);
      if (problem) throw new BadRequestException(problem);
    }
    after.requestSources = [...new Set(after.requestSources)];
    after.chaseRoles = [...new Set(after.chaseRoles)];
    after.securityRoles = [...new Set(after.securityRoles)];
    if (dto.clientPriorityTiers !== undefined) {
      const problem = tiersProblem(dto.clientPriorityTiers);
      if (problem) throw new BadRequestException(problem);
      after.clientPriorityTiers = dto.clientPriorityTiers.map((t) => t.trim());
      // A task's tier is a position in the list - shortening it would orphan tiers in use.
      const [{ max }] = await this.projectsRepository.query(`SELECT MAX("clientPriorityTier") AS max FROM project_tasks WHERE "tenantId" = $1`, [tenantId]);
      if (max && Number(max) > after.clientPriorityTiers.length) throw new BadRequestException(`Tasks use tier ${max}; keep at least ${max} tiers (rename them instead).`);
    }
    if (dto.satisfactionQuestions !== undefined) {
      const problem = questionsProblem(dto.satisfactionQuestions);
      if (problem) throw new BadRequestException(problem);
      after.satisfactionQuestions = dto.satisfactionQuestions.map((q) => q.trim());
    }
    if (dto.securitySlaDays !== undefined) {
      const problem = slaDaysProblem(dto.securitySlaDays);
      if (problem) throw new BadRequestException(problem);
      after.securitySlaDays = { ...(dto.securitySlaDays as SlaDays) };
    }
    after.overrideUserIds = [...new Set(after.overrideUserIds)];
    if (dto.overrideUserIds !== undefined && after.overrideUserIds.length) {
      const people = await this.usersRepository.find({ where: { id: In(after.overrideUserIds), tenantId } });
      const bad = after.overrideUserIds.filter((id) => !people.some((p) => p.id === id && OVERRIDE_USER_ROLES.includes(p.role)));
      if (bad.length) throw new BadRequestException(`Only Admin, Executive or Program Manager accounts can override scores (not ${bad.map((id) => `#${id}`).join(', ')}).`);
    }
    // Q5: technical reviewers come from the same accounts as override users.
    after.techReviewerUserIds = [...new Set(after.techReviewerUserIds)];
    if (dto.techReviewerUserIds !== undefined && after.techReviewerUserIds.length) {
      const people = await this.usersRepository.find({ where: { id: In(after.techReviewerUserIds), tenantId } });
      const bad = after.techReviewerUserIds.filter((id) => !people.some((p) => p.id === id && OVERRIDE_USER_ROLES.includes(p.role)));
      if (bad.length) throw new BadRequestException(`Only Admin, Executive or Program Manager accounts can be technical reviewers (not ${bad.map((id) => `#${id}`).join(', ')}).`);
    }
    if (dto.techReviewCriteria !== undefined) {
      const problem = criteriaProblem(dto.techReviewCriteria);
      if (problem) throw new BadRequestException(problem);
      after.techReviewCriteria = dto.techReviewCriteria.map((c) => c.trim());
    }
    if (dto.escalationReasons !== undefined) {
      // New reasons get a code from their label; existing codes never change.
      const used = new Set(dto.escalationReasons.filter((r) => r && r.code).map((r) => r.code!));
      after.escalationReasons = dto.escalationReasons.map((r) => {
        let code = r?.code;
        if (!code) {
          const base = codeFor(String(r?.label ?? ''));
          code = base;
          for (let n = 2; used.has(code); n++) code = `${base}_${n}`;
          used.add(code);
        }
        return { code, label: String(r?.label ?? '').trim(), avoidable: r?.avoidable as boolean };
      });
      const problem = reasonsProblem(after.escalationReasons);
      if (problem) throw new BadRequestException(problem);
    }
    if (!HHMM.test(after.weeklyReportDeadlineTime)) throw new BadRequestException('The weekly report deadline time must be HH:MM, e.g. 17:00.');
    const calendar = calendarProblem({ timeZone: after.calendarTimeZone, workStart: after.calendarWorkStart, workEnd: after.calendarWorkEnd, weekendDays: after.calendarWeekendDays });
    if (calendar) throw new BadRequestException(calendar);
    after.calendarWeekendDays = [...after.calendarWeekendDays].sort();
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
