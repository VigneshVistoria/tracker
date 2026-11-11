import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
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
  excuseReasonsProblem,
  switchOnProblem,
  trackedSeriesProblem,
} from './meeting-attendance';
import { UpdateMeetingAttendanceSettingsDto } from './dto/meeting-attendance.dto';

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
    private readonly auditLogService: AuditLogService,
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
}
