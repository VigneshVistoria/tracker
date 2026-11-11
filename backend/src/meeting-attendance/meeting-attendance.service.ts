import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { Project } from '../projects/project.entity';
import { User, UserRole } from '../users/user.entity';
import { PerformanceTrackingSettings } from '../performance-tracking/performance-tracking-settings.entity';
import {
  MEETING_ATTENDANCE_AUDIT,
  MEETING_ATTENDANCE_DEFAULTS,
  MEETING_EXCUSE_ROLE_CHOICES,
  MEETING_LIMITS,
  MEETING_SETTING_KEYS,
  MeetingAttendanceSettings,
  EXCUSE_NOTE_MAX,
  c6Summary,
  canOpenMeetingPage,
  excuseReasonsProblem,
  switchOnProblem,
  trackedSeriesProblem,
} from './meeting-attendance';
import { ExcuseAttendanceDto, UpdateMeetingAttendanceSettingsDto } from './dto/meeting-attendance.dto';
import { MeetingAttendance } from './meeting-attendance.entity';

type Actor = { id: number; email: string; role: UserRole };

// C6 meeting attendance - see ./meeting-attendance.ts. Stage 1: the
// settings (Admin edits, audited). The C6 columns live on
// performance_tracking_settings but are read and saved only here.
@Injectable()
export class MeetingAttendanceService {
  constructor(
    @InjectRepository(PerformanceTrackingSettings) private readonly settingsRepository: Repository<PerformanceTrackingSettings>,
    @InjectRepository(Project) private readonly projectsRepository: Repository<Project>,
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
    @InjectRepository(MeetingAttendance) private readonly attendanceRepository: Repository<MeetingAttendance>,
    private readonly auditLogService: AuditLogService,
    private readonly dataSource: DataSource,
  ) {}

  async settings(tenantId: number): Promise<MeetingAttendanceSettings> {
    const row = await this.settingsRepository.findOne({ where: { tenantId } });
    const out: MeetingAttendanceSettings = JSON.parse(JSON.stringify(MEETING_ATTENDANCE_DEFAULTS));
    if (!row) return out;
    for (const key of MEETING_SETTING_KEYS) {
      if ((row as any)[key] !== undefined && (row as any)[key] !== null) (out as any)[key] = (row as any)[key];
    }
    return out;
  }

  async page(tenantId: number) {
    const [settings, projects, people] = await Promise.all([
      this.settings(tenantId),
      this.projectsRepository.find({ where: { tenantId }, order: { name: 'ASC' } }),
      this.usersRepository.find({ where: { tenantId, role: Not(UserRole.CLIENT) }, order: { fullName: 'ASC' } }),
    ]);
    return {
      settings,
      limits: MEETING_LIMITS,
      choices: {
        projects: projects.map((p) => ({ id: p.id, name: p.name, performanceTrackingEnabled: !!p.performanceTrackingEnabled })),
        organisers: people.map((u) => ({ id: u.id, name: u.fullName || u.email, email: u.email, role: u.role })),
        excuseRoles: MEETING_EXCUSE_ROLE_CHOICES,
      },
    };
  }

  async saveSettings(dto: UpdateMeetingAttendanceSettingsDto, actor: Actor, tenantId: number) {
    const before = await this.settings(tenantId);
    const after: MeetingAttendanceSettings = JSON.parse(JSON.stringify(before));
    for (const key of MEETING_SETTING_KEYS) {
      if ((dto as any)[key] !== undefined) (after as any)[key] = JSON.parse(JSON.stringify((dto as any)[key]));
    }
    after.meetingAttendanceProjectIds = [...new Set(after.meetingAttendanceProjectIds)];
    after.meetingOrganiserUserIds = [...new Set(after.meetingOrganiserUserIds)];
    after.meetingExcuseRoles = [...new Set(after.meetingExcuseRoles)];
    if (after.meetingAttendanceProjectIds.length) {
      const found = await this.projectsRepository.count({ where: { tenantId, id: In(after.meetingAttendanceProjectIds) } });
      if (found !== after.meetingAttendanceProjectIds.length) throw new BadRequestException('One of the projects does not exist.');
    }
    if (after.meetingOrganiserUserIds.length) {
      const people = await this.usersRepository.find({ where: { tenantId, id: In(after.meetingOrganiserUserIds) } });
      const bad = after.meetingOrganiserUserIds.filter((id) => !people.some((p) => p.id === id && p.role !== UserRole.CLIENT && p.email));
      if (bad.length) throw new BadRequestException(`Organisers must be internal accounts with an email (not ${bad.map((id) => `#${id}`).join(', ')}).`);
    }
    after.meetingTrackedSeries = after.meetingTrackedSeries.map((s) => ({ organiserUserId: s.organiserUserId, seriesId: s.seriesId, subject: String(s.subject ?? '').trim() }));
    const seriesProblem = trackedSeriesProblem(after.meetingTrackedSeries, after.meetingOrganiserUserIds);
    if (seriesProblem) throw new BadRequestException(seriesProblem);
    const reasonsProblem = excuseReasonsProblem(after.meetingExcuseReasons);
    if (reasonsProblem) throw new BadRequestException(reasonsProblem);
    after.meetingExcuseReasons = after.meetingExcuseReasons.map((r) => r.trim());
    if (after.meetingExcuseRoles.length === 0) throw new BadRequestException('Pick at least one role that can mark a meeting Excused.');
    const onProblem = switchOnProblem(after);
    if (onProblem) throw new BadRequestException(onProblem);

    const existing = await this.settingsRepository.findOne({ where: { tenantId } });
    if (existing) {
      await this.settingsRepository.update({ tenantId }, { ...(after as any), updatedByUserId: actor.id });
    } else {
      await this.settingsRepository.insert({ tenantId, ...(after as any), updatedByUserId: actor.id });
    }
    await this.auditLogService.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: MEETING_ATTENDANCE_AUDIT.SETTINGS_UPDATED,
      tenantId,
      entityType: 'PerformanceTrackingSettings',
      entityId: tenantId,
      details: { before, after },
    });
    return this.page(tenantId);
  }

  // ---- Stage 3 ----

  async assertCanOpen(tenantId: number, role: UserRole) {
    if (!canOpenMeetingPage(role, await this.settings(tenantId))) throw new ForbiddenException('Only an Admin or Program Manager can see meeting attendance.');
  }

  // The imported meetings of the last `days` days, newest first, with
  // every invitee's outcome and any Excused mark.
  async meetings(tenantId: number, viewer: Actor, days: number) {
    const settings = await this.settings(tenantId);
    const since = new Date(Date.now() - days * 86_400_000);
    const occ: any[] = await this.dataSource.query(
      `SELECT id, "organiserUserId", subject, "startAt", "endAt", status, "invitedCount" FROM meeting_occurrences
        WHERE "tenantId" = $1 AND "startAt" >= $2 ORDER BY "startAt" DESC, id DESC`,
      [tenantId, since],
    );
    const rows: any[] = occ.length
      ? await this.dataSource.query(
          `SELECT a.id, a."occurrenceId", a."userId", a."firstJoinAt", a."lastLeaveAt", a."attendedSeconds", a.outcome, a.excused, a."excuseReason", a."excuseNote", a."excusedByUserId", a."excusedAt"
             FROM meeting_attendance a WHERE a."tenantId" = $1 AND a."occurrenceId" = ANY($2) ORDER BY a.id`,
          [tenantId, occ.map((o) => o.id)],
        )
      : [];
    const people = await this.usersRepository.find({ where: { tenantId } });
    const scope = await this.excuseScope(tenantId, viewer, settings);
    const name = (id: number | null) => (id ? people.find((u) => u.id === id)?.fullName || people.find((u) => u.id === id)?.email || `#${id}` : null);
    return {
      days,
      canExcuse: scope !== null,
      excuseReasons: settings.meetingExcuseReasons,
      meetings: occ.map((o) => ({
        ...o,
        organiserName: name(o.organiserUserId),
        attendance: rows
          .filter((r) => r.occurrenceId === o.id)
          .map((r) => ({ ...r, name: name(r.userId), excusedByName: name(r.excusedByUserId), canExcuse: r.userId !== viewer.id && mayExcuse(scope, r.userId) }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      })),
    };
  }

  // Decision 6: mark a late / short / absent meeting Excused (reason from
  // the list, optional note). Not your own. Audited.
  async excuse(tenantId: number, attendanceId: number, dto: ExcuseAttendanceDto, actor: Actor) {
    const settings = await this.settings(tenantId);
    const scope = await this.excuseScope(tenantId, actor, settings);
    if (scope === null) throw new ForbiddenException('Your role cannot mark meetings Excused.');
    const row = await this.attendanceRepository.findOne({ where: { id: attendanceId, tenantId } });
    if (!row) throw new NotFoundException(`Attendance #${attendanceId} not found`);
    if (row.userId === actor.id) throw new ForbiddenException('You cannot excuse your own attendance.');
    if (!mayExcuse(scope, row.userId)) throw new ForbiddenException('A Program Manager can only excuse people on their own projects.');
    if (row.outcome === 'on_time') throw new BadRequestException('This person attended on time - there is nothing to excuse.');
    if (row.excused) throw new BadRequestException('Already excused - reload to see it.');
    const reason = settings.meetingExcuseReasons.find((r) => r.toLowerCase() === String(dto.reason ?? '').trim().toLowerCase());
    if (!reason) throw new BadRequestException(`Pick one of the reasons: ${settings.meetingExcuseReasons.join(', ')}.`);
    const note = (dto.note ?? '').trim().slice(0, EXCUSE_NOTE_MAX) || null;
    await this.dataSource.transaction(async (em) => {
      const res = await em.update(MeetingAttendance, { id: row.id, excused: false }, { excused: true, excuseReason: reason, excuseNote: note, excusedByUserId: actor.id, excusedAt: new Date() });
      if (!res.affected) throw new BadRequestException('Already excused - reload to see it.');
      await this.auditLogService.recordWithin(em, {
        userId: actor.id,
        userEmail: actor.email,
        userRole: actor.role,
        action: MEETING_ATTENDANCE_AUDIT.EXCUSED,
        tenantId,
        entityType: 'MeetingAttendance',
        entityId: row.id,
        details: { attendanceId: row.id, occurrenceId: row.occurrenceId, userId: row.userId, outcome: row.outcome, reason, note },
      });
    });
    return { ok: true };
  }

  async removeExcuse(tenantId: number, attendanceId: number, actor: Actor) {
    const settings = await this.settings(tenantId);
    const scope = await this.excuseScope(tenantId, actor, settings);
    if (scope === null) throw new ForbiddenException('Your role cannot change Excused marks.');
    const row = await this.attendanceRepository.findOne({ where: { id: attendanceId, tenantId } });
    if (!row) throw new NotFoundException(`Attendance #${attendanceId} not found`);
    if (row.userId === actor.id) throw new ForbiddenException('You cannot change an Excused mark on your own attendance.');
    if (!mayExcuse(scope, row.userId)) throw new ForbiddenException('A Program Manager can only change Excused marks for people on their own projects.');
    if (!row.excused) throw new BadRequestException('Not excused - reload to see it.');
    await this.dataSource.transaction(async (em) => {
      const res = await em.update(MeetingAttendance, { id: row.id, excused: true }, { excused: false, excuseReason: null, excuseNote: null, excusedByUserId: null, excusedAt: null });
      if (!res.affected) throw new BadRequestException('Not excused - reload to see it.');
      await this.auditLogService.recordWithin(em, {
        userId: actor.id,
        userEmail: actor.email,
        userRole: actor.role,
        action: MEETING_ATTENDANCE_AUDIT.EXCUSE_REMOVED,
        tenantId,
        entityType: 'MeetingAttendance',
        entityId: row.id,
        details: { attendanceId: row.id, occurrenceId: row.occurrenceId, userId: row.userId, was: { reason: row.excuseReason, note: row.excuseNote, by: row.excusedByUserId, at: row.excusedAt } },
      });
    });
    return { ok: true };
  }

  // Whom the actor may excuse: 'all' (Admin always; an Executive when
  // allowed), the people sharing a project with them (a Program Manager
  // when allowed), or null (nobody).
  private async excuseScope(tenantId: number, actor: Actor, settings: MeetingAttendanceSettings): Promise<'all' | Set<number> | null> {
    if (actor.role === UserRole.ADMIN) return 'all';
    if (!settings.meetingExcuseRoles.includes(actor.role)) return null;
    if (actor.role !== UserRole.PROGRAM_MANAGER) return 'all';
    const rows: Array<{ userId: number }> = await this.dataSource.query(
      `SELECT DISTINCT b."usersId" AS "userId" FROM user_projects a
         JOIN user_projects b ON b."projectsId" = a."projectsId"
         JOIN projects p ON p.id = a."projectsId" AND p."tenantId" = $2
        WHERE a."usersId" = $1`,
      [actor.id, tenantId],
    );
    return new Set(rows.map((r) => r.userId));
  }

  // C6 per person for the scorecard: meetings that started in [from, to).
  async c6ByUser(tenantId: number, userIds: number[], from: Date, to: Date): Promise<Map<number, ReturnType<typeof c6Summary>>> {
    const out = new Map<number, ReturnType<typeof c6Summary>>();
    if (!userIds.length) return out;
    const rows: Array<{ userId: number; outcome: any; excused: boolean }> = await this.dataSource.query(
      `SELECT a."userId", a.outcome, a.excused FROM meeting_attendance a JOIN meeting_occurrences o ON o.id = a."occurrenceId"
        WHERE a."tenantId" = $1 AND a."userId" = ANY($2) AND o.status = 'imported' AND o."startAt" >= $3 AND o."startAt" < $4`,
      [tenantId, userIds, from, to],
    );
    for (const id of userIds) out.set(id, c6Summary(rows.filter((r) => r.userId === id)));
    return out;
  }
}

function mayExcuse(scope: 'all' | Set<number> | null, userId: number): boolean {
  return scope === 'all' || (scope !== null && scope.has(userId));
}
