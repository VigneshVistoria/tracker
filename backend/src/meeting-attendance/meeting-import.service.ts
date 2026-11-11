import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Not, Repository } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { TenantsService } from '../tenants/tenants.service';
import { User, UserRole } from '../users/user.entity';
import { MeetingAttendanceImport } from './meeting-attendance-import.entity';
import { MeetingOccurrence } from './meeting-occurrence.entity';
import { MeetingAttendance } from './meeting-attendance.entity';
import { MeetingGraphClient, MeetingGraphError } from './meeting-graph.client';
import { MeetingAttendanceService } from './meeting-attendance.service';
import { GraphReport, MEETING_ATTENDANCE_AUDIT, attendanceRows, reportsForInstance } from './meeting-attendance';

const LOCK_KEY = 774466;
const STALE_IMPORT_MS = 30 * 60_000;

type Actor = { id: number; email: string; role: UserRole };

export interface ImportResult {
  importId: number;
  status: 'done' | 'failed' | 'skipped';
  meetingsFound: number;
  reportsRead: number;
  rowsWritten: number;
  error: string | null;
}

// C6 Stage 2 - copies attendance of the tracked Teams meetings into
// meeting_occurrences / meeting_attendance. Nightly at 01:30 EAT (before
// the 02:00 metrics run) and on "Import now". Only while C6 is on. Reads
// Graph only (GET); looks back meetingImportDays. Re-importing a meeting
// refreshes join/leave times and the outcome but never an Excused mark.
@Injectable()
export class MeetingImportService {
  private readonly logger = new Logger(MeetingImportService.name);

  constructor(
    @InjectRepository(MeetingAttendanceImport) private readonly importsRepository: Repository<MeetingAttendanceImport>,
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
    private readonly meetings: MeetingAttendanceService,
    private readonly graph: MeetingGraphClient,
    private readonly tenantsService: TenantsService,
    private readonly auditLogService: AuditLogService,
    private readonly dataSource: DataSource,
  ) {}

  @Cron('30 1 * * *', { timeZone: 'Africa/Addis_Ababa' })
  async nightly() {
    for (const tenant of await this.tenantsService.findAll()) {
      try {
        const settings = await this.meetings.settings(tenant.id);
        if (!settings.meetingAttendanceEnabled) continue;
        const r = await this.run(tenant.id, 'nightly');
        this.logger.log(`C6 import tenant #${tenant.id}: ${r.status}, ${r.meetingsFound} meetings, ${r.rowsWritten} rows${r.error ? ` - ${r.error}` : ''}`);
      } catch (err: any) {
        this.logger.error(`C6 import failed for tenant #${tenant.id}: ${err?.message ?? err}`);
      }
    }
  }

  // "Import now" - Admin or PM; audited.
  async importNow(tenantId: number, actor: Actor): Promise<ImportResult> {
    const settings = await this.meetings.settings(tenantId);
    if (!settings.meetingAttendanceEnabled) throw new BadRequestException('Switch C6 on first - nothing is imported while it is off.');
    const result = await this.run(tenantId, 'manual', actor.id);
    await this.auditLogService.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: MEETING_ATTENDANCE_AUDIT.IMPORT_RUN,
      tenantId,
      entityType: 'MeetingAttendanceImport',
      entityId: result.importId,
      details: { ...result },
    });
    return result;
  }

  // Series picker (Admin): the organiser's recurring Teams meetings.
  async listSeries(tenantId: number, organiserUserId: number) {
    const settings = await this.meetings.settings(tenantId);
    if (!settings.meetingOrganiserUserIds.includes(organiserUserId)) throw new BadRequestException('Add this person to the organisers (and save) first.');
    const user = await this.usersRepository.findOne({ where: { id: organiserUserId, tenantId } });
    if (!user?.email) throw new BadRequestException('This organiser has no email.');
    try {
      const aad = await this.graph.userId(user.email);
      const series = await this.graph.listSeries(aad);
      const tracked = new Set(settings.meetingTrackedSeries.map((s) => s.seriesId));
      return series.map((s) => ({ ...s, organiserUserId, tracked: tracked.has(s.seriesId) })).sort((a, b) => a.subject.localeCompare(b.subject));
    } catch (err: any) {
      if (err instanceof MeetingGraphError) {
        throw new BadRequestException(
          err.status === 403 ? `Microsoft Teams refused to show ${user.email}'s meetings (403) - is this person covered by the Tracker-C6 access policy?` : err.message,
        );
      }
      throw err;
    }
  }

  async recent(tenantId: number, limit = 10) {
    return this.importsRepository.find({ where: { tenantId }, order: { startedAt: 'DESC', id: 'DESC' }, take: limit });
  }

  async run(tenantId: number, trigger: 'nightly' | 'manual', userId?: number, now = new Date()): Promise<ImportResult> {
    await this.importsRepository.update(
      { tenantId, status: 'running', startedAt: LessThan(new Date(now.getTime() - STALE_IMPORT_MS)) },
      { status: 'failed', error: 'Interrupted (server restart?)', finishedAt: now },
    );
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }] = await runner.query(`SELECT pg_try_advisory_lock($1, $2) AS locked`, [LOCK_KEY, tenantId]);
      if (!locked) {
        const skipped = await this.importsRepository.save(
          this.importsRepository.create({ tenantId, trigger, userId: userId ?? null, status: 'skipped', error: 'Another import was still going.', finishedAt: new Date() }),
        );
        return { importId: skipped.id, status: 'skipped', meetingsFound: 0, reportsRead: 0, rowsWritten: 0, error: skipped.error };
      }
      const row = await this.importsRepository.save(this.importsRepository.create({ tenantId, trigger, userId: userId ?? null, status: 'running' }));
      try {
        const counts = await this.importAll(tenantId, now);
        const status = counts.errors.length ? 'failed' : 'done';
        const error = counts.errors.length ? counts.errors.join(' | ').slice(0, 2000) : null;
        await this.importsRepository.update({ id: row.id }, { status, error, finishedAt: new Date(), meetingsFound: counts.meetingsFound, reportsRead: counts.reportsRead, rowsWritten: counts.rowsWritten });
        return { importId: row.id, status, meetingsFound: counts.meetingsFound, reportsRead: counts.reportsRead, rowsWritten: counts.rowsWritten, error };
      } catch (err: any) {
        const error = String(err?.message ?? err).slice(0, 2000);
        await this.importsRepository.update({ id: row.id }, { status: 'failed', error, finishedAt: new Date() });
        return { importId: row.id, status: 'failed', meetingsFound: 0, reportsRead: 0, rowsWritten: 0, error };
      } finally {
        await runner.query(`SELECT pg_advisory_unlock($1, $2)`, [LOCK_KEY, tenantId]);
      }
    } finally {
      await runner.release();
    }
  }

  private async importAll(tenantId: number, now: Date) {
    const settings = await this.meetings.settings(tenantId);
    const people = await this.usersRepository.find({ where: { tenantId, role: Not(UserRole.CLIENT) } });
    const userIdByEmail = new Map(people.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u.id]));
    const emailOf = new Map(people.map((u) => [u.id, u.email]));
    const from = new Date(now.getTime() - settings.meetingImportDays * 86_400_000);
    const counts = { meetingsFound: 0, reportsRead: 0, rowsWritten: 0, errors: [] as string[] };
    const aadIds = new Map<number, string>();

    for (const series of settings.meetingTrackedSeries) {
      try {
        const email = emailOf.get(series.organiserUserId);
        if (!email) throw new Error(`organiser #${series.organiserUserId} has no tracker account`);
        if (!aadIds.has(series.organiserUserId)) aadIds.set(series.organiserUserId, await this.graph.userId(email));
        const aad = aadIds.get(series.organiserUserId)!;
        // Only meetings that have ended.
        const instances = (await this.graph.listInstances(aad, series.seriesId, from, now)).filter((i) => i.endAt.getTime() <= now.getTime());
        let reports: GraphReport[] | null = null;
        let meetingId: string | null = null;
        for (const inst of instances) {
          counts.meetingsFound += 1;
          if (inst.cancelled) {
            await this.saveOccurrence(tenantId, series, inst, 'cancelled', null, 0, []);
            continue;
          }
          // Every instance of a recurring Teams meeting shares one meeting
          // (one join link), with one attendance report per time held.
          if (reports === null && inst.joinUrl) {
            meetingId = await this.graph.onlineMeetingId(aad, inst.joinUrl);
            reports = meetingId ? await this.graph.listReports(aad, meetingId) : [];
          }
          const mine = reportsForInstance(inst, reports ?? []);
          const invited = inst.invitees.filter((e) => userIdByEmail.has(e)).length;
          if (!mine.length || !meetingId) {
            await this.saveOccurrence(tenantId, series, inst, 'no_report', null, invited, []);
            continue;
          }
          const records = [];
          for (const r of mine) {
            records.push(...(await this.graph.listRecords(aad, meetingId, r.reportId)));
            counts.reportsRead += 1;
          }
          const rows = attendanceRows(inst, records, userIdByEmail, { lateMinutes: settings.meetingLateMinutes, minStayPercent: settings.meetingMinStayPercent });
          counts.rowsWritten += await this.saveOccurrence(tenantId, series, inst, 'imported', mine.map((r) => r.reportId).join(','), invited, rows);
        }
      } catch (err: any) {
        counts.errors.push(`"${series.subject}": ${String(err?.message ?? err).slice(0, 400)}`);
      }
    }
    return counts;
  }

  // Upsert one meeting and its rows; Excused marks are never touched.
  private async saveOccurrence(
    tenantId: number,
    series: { organiserUserId: number; seriesId: string },
    inst: { eventId: string; subject: string; startAt: Date; endAt: Date },
    status: MeetingOccurrence['status'],
    reportId: string | null,
    invitedCount: number,
    rows: ReturnType<typeof attendanceRows>,
  ): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      const values = {
        organiserUserId: series.organiserUserId,
        seriesId: series.seriesId,
        subject: inst.subject,
        startAt: inst.startAt,
        endAt: inst.endAt,
        reportId: reportId ? reportId.slice(0, 512) : null,
        status,
        invitedCount,
        importedAt: new Date(),
      };
      let occ = await em.findOne(MeetingOccurrence, { where: { tenantId, eventId: inst.eventId } });
      if (occ) {
        // A meeting already read with a report keeps it if Teams later
        // returns nothing (report expired) - only better data replaces it.
        if (occ.status === 'imported' && status !== 'imported') return 0;
        await em.update(MeetingOccurrence, { id: occ.id }, values);
      } else {
        const ins = await em.insert(MeetingOccurrence, { tenantId, eventId: inst.eventId, ...values });
        occ = { id: ins.identifiers[0].id } as MeetingOccurrence;
      }
      for (const r of rows) {
        await em.query(
          `INSERT INTO meeting_attendance ("tenantId", "occurrenceId", "userId", "firstJoinAt", "lastLeaveAt", "attendedSeconds", outcome)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT ("occurrenceId", "userId") DO UPDATE SET "firstJoinAt" = EXCLUDED."firstJoinAt", "lastLeaveAt" = EXCLUDED."lastLeaveAt",
             "attendedSeconds" = EXCLUDED."attendedSeconds", outcome = EXCLUDED.outcome`,
          [tenantId, occ.id, r.userId, r.firstJoinAt, r.lastLeaveAt, r.attendedSeconds, r.outcome],
        );
      }
      return rows.length;
    });
  }
}
