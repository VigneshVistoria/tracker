import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { WeeklyStatusReport } from './weekly-status-report.entity';
import { Project } from '../projects/project.entity';
import { DEVELOPER_EQUIVALENT_ROLES, User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { PerformanceTrackingService } from '../performance-tracking/performance-tracking.service';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TEAM_SETTINGS_DEFAULTS, dateInZone, isValidTimeZone } from '../team-settings/time-zone';
import { addCalendarDays } from '../performance-metrics/working-days';
import { WEEKLY_STATUS_AUDIT, WEEKLY_STATUS_TEAM_ROLES, mondayOf, weekStatus, weeklyDeadline } from './weekly-status';
import { SubmitWeeklyStatusDto } from './dto/weekly-status.dto';

const nameOf = (u: User) => u.fullName || u.email;
const text = (r: WeeklyStatusReport) => ({ done: r.done, plan: r.plan, blockers: r.blockers });

// Performance Tracking C3 - weekly status report. See ./weekly-status.ts.
@Injectable()
export class WeeklyStatusService {
  constructor(
    @InjectRepository(WeeklyStatusReport) private reports: Repository<WeeklyStatusReport>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Project) private projects: Repository<Project>,
    private tracking: PerformanceTrackingService,
    private auditLogService: AuditLogService,
    private dataSource: DataSource,
  ) {}

  private async context(user: User, tenantId: number) {
    const canSubmit = DEVELOPER_EQUIVALENT_ROLES.includes(user.role);
    const seesTeam = WEEKLY_STATUS_TEAM_ROLES.includes(user.role);
    if (!canSubmit && !seesTeam) throw new ForbiddenException('You cannot see weekly status reports.');
    if (!(await this.projects.count({ where: { tenantId, performanceTrackingEnabled: true } }))) {
      throw new BadRequestException('Weekly status reports start once Performance Tracking is on for a project.');
    }
    const th = await this.tracking.thresholds(tenantId);
    const settings = await this.dataSource.getRepository(TeamSettings).findOne({ where: { tenantId } });
    const zone = isValidTimeZone(settings?.timeZone) ? settings!.timeZone : TEAM_SETTINGS_DEFAULTS.timeZone;
    const now = new Date();
    const currentWeek = mondayOf(dateInZone(now, zone));
    return { th, zone, now, currentWeek, canSubmit, seesTeam };
  }

  async page(week: string | undefined, user: User, tenantId: number) {
    const { th, zone, now, currentWeek, canSubmit, seesTeam } = await this.context(user, tenantId);
    const monday = week ? mondayOf(week) : currentWeek;
    if (monday > currentWeek) throw new BadRequestException('That week has not started yet.');
    const deadline = weeklyDeadline(monday, th.weeklyReportDeadlineDay, th.weeklyReportDeadlineTime, zone);
    const people = seesTeam
      ? (await this.users.find({ where: { tenantId, role: In(DEVELOPER_EQUIVALENT_ROLES) }, order: { fullName: 'ASC' } })).filter((u) => u.email !== process.env.SMOKE_TEST_EMAIL)
      : [];
    const rows = await this.reports.find({ where: { tenantId, weekStart: monday, ...(seesTeam ? {} : { userId: user.id }) } });
    const mine = canSubmit ? rows.find((r) => r.userId === user.id) ?? null : null;
    return {
      week: monday,
      currentWeek,
      timeZone: zone,
      deadlineAt: deadline,
      deadlinePassed: now.getTime() > deadline.getTime(),
      minLength: th.weeklyReportMinLength,
      canSubmit,
      editable: canSubmit && (monday === currentWeek || monday === addCalendarDays(currentWeek, -7)),
      mine: mine
        ? { ...text(mine), submittedAt: mine.submittedAt, updatedAt: mine.updatedAt, deadlineAt: mine.deadlineAt, status: weekStatus(mine.submittedAt, mine.deadlineAt, now) }
        : null,
      team: seesTeam
        ? people.map((p) => {
            const r = rows.find((x) => x.userId === p.id);
            return {
              userId: p.id,
              name: nameOf(p),
              submittedAt: r?.submittedAt ?? null,
              status: r ? weekStatus(r.submittedAt, r.deadlineAt, now) : weekStatus(null, deadline, now),
              report: r ? text(r) : null,
            };
          })
        : null,
    };
  }

  async submit(dto: SubmitWeeklyStatusDto, user: User, tenantId: number) {
    const { th, zone, now, currentWeek, canSubmit } = await this.context(user, tenantId);
    if (!canSubmit) throw new ForbiddenException('Only Developers, Designers and DevOps submit a weekly status report.');
    const monday = mondayOf(dto.week);
    if (monday !== currentWeek && monday !== addCalendarDays(currentWeek, -7)) throw new BadRequestException('Only this week or last week can be submitted.');
    const done = dto.done.trim();
    const plan = dto.plan.trim();
    const blockers = (dto.blockers ?? '').trim() || null;
    if (done.length < th.weeklyReportMinLength || plan.length < th.weeklyReportMinLength) {
      throw new BadRequestException(`"Done this week" and "Plan for next week" need at least ${th.weeklyReportMinLength} characters each.`);
    }
    const existing = await this.reports.findOne({ where: { tenantId, userId: user.id, weekStart: monday } });
    await this.dataSource.transaction(async (em) => {
      if (existing) {
        if (existing.done === done && existing.plan === plan && existing.blockers === blockers) return;
        await em.update(WeeklyStatusReport, { id: existing.id }, { done, plan, blockers, updatedAt: now });
        await this.auditLogService.recordWithin(em, {
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: WEEKLY_STATUS_AUDIT.UPDATED,
          tenantId,
          entityType: 'WeeklyStatusReport',
          entityId: existing.id,
          details: { week: monday, before: text(existing), after: { done, plan, blockers } },
        });
        return;
      }
      const deadlineAt = weeklyDeadline(monday, th.weeklyReportDeadlineDay, th.weeklyReportDeadlineTime, zone);
      const row = await em.save(em.create(WeeklyStatusReport, { tenantId, userId: user.id, weekStart: monday, done, plan, blockers, submittedAt: now, deadlineAt, updatedAt: now }));
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: WEEKLY_STATUS_AUDIT.SUBMITTED,
        tenantId,
        entityType: 'WeeklyStatusReport',
        entityId: row.id,
        details: { week: monday, submittedAt: now, deadlineAt, onTime: now.getTime() <= deadlineAt.getTime() },
      });
    });
    return this.page(monday, user, tenantId);
  }
}
