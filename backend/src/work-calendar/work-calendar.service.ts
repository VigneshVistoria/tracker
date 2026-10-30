import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User, UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuditLogService } from '../audit/audit-log.service';
import { PerformanceTrackingService } from '../performance-tracking/performance-tracking.service';
import { PERFORMANCE_TRACKING_SETTINGS_ROLES, calendarProblem } from '../performance-tracking/performance-tracking';
import { PerformanceMetricsService } from '../performance-metrics/performance-metrics.service';
import { PersonWorkCalendar } from './person-work-calendar.entity';
import { PersonLeave } from './person-leave.entity';
import { CountryHoliday } from './country-holiday.entity';
import { COUNTRIES, COUNTRY_LABEL, Country, LEAVE_MAX_DAYS, PersonCalendar, WORK_CALENDAR_AUDIT, daysBetween } from './work-calendar';
import { AddCountryHolidayDto, AddLeaveDto, SetPersonCalendarDto } from './dto/work-calendar.dto';

type Actor = Pick<User, 'id' | 'email' | 'role' | 'tenantId'>;

// Per-person working calendar, leave and country holidays (B4) - edited by
// Admin and Program Manager (same as the tracking settings), audited.
@Injectable()
export class WorkCalendarService {
  constructor(
    @InjectRepository(PersonWorkCalendar) private calendarsRepository: Repository<PersonWorkCalendar>,
    @InjectRepository(PersonLeave) private leaveRepository: Repository<PersonLeave>,
    @InjectRepository(CountryHoliday) private holidaysRepository: Repository<CountryHoliday>,
    private tracking: PerformanceTrackingService,
    private metrics: PerformanceMetricsService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
  ) {}

  assertEditor(actor: Actor) {
    if (!PERFORMANCE_TRACKING_SETTINGS_ROLES.includes(actor.role)) throw new ForbiddenException('Only an Admin or Program Manager can do this.');
  }

  private async audit(actor: Actor, action: string, entityId: number, details: Record<string, unknown>) {
    await this.auditLogService.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action,
      tenantId: actor.tenantId,
      entityType: 'User',
      entityId,
      details,
    });
  }

  private async person(userId: number, tenantId: number): Promise<User> {
    const user = await this.usersService.findByIdAndTenant(userId, tenantId);
    if (!user || user.role === UserRole.CLIENT) throw new NotFoundException(`User #${userId} not found`);
    return user;
  }

  // The effective calendar of everyone in the tenant (clients left out).
  async calendarsFor(tenantId: number): Promise<{ byUser: Map<number, PersonCalendar>; fallback: PersonCalendar }> {
    const [settings, rows, leave, countryHolidays, tenantHolidays] = await Promise.all([
      this.tracking.thresholds(tenantId),
      this.calendarsRepository.find({ where: { tenantId } }),
      this.leaveRepository.find({ where: { tenantId, removedAt: IsNull() } }),
      this.holidaysRepository.find({ where: { tenantId } }),
      this.metrics.listHolidays(tenantId),
    ]);
    const shared = new Set(tenantHolidays.map((h) => h.date));
    const byCountry = new Map<string, string[]>();
    for (const h of countryHolidays) byCountry.set(h.country, [...(byCountry.get(h.country) ?? []), h.date]);
    const leaveBy = new Map<number, string[]>();
    for (const l of leave) leaveBy.set(l.userId, [...(leaveBy.get(l.userId) ?? []), ...daysBetween(l.startDate, l.endDate)]);
    const build = (row: PersonWorkCalendar | null, userId: number | null): PersonCalendar => {
      const country = row?.country ?? null;
      return {
        timeZone: row?.timeZone ?? settings.calendarTimeZone,
        workStart: row?.workStart ?? settings.calendarWorkStart,
        workEnd: row?.workEnd ?? settings.calendarWorkEnd,
        weekendDays: row?.weekendDays ?? settings.calendarWeekendDays,
        country,
        daysOff: new Set([...shared, ...(country ? byCountry.get(country) ?? [] : []), ...(userId ? leaveBy.get(userId) ?? [] : [])]),
      };
    };
    const users = (await this.usersService.findAll(tenantId)).filter((u) => u.role !== UserRole.CLIENT);
    const rowBy = new Map(rows.map((r) => [r.userId, r]));
    return { byUser: new Map(users.map((u) => [u.id, build(rowBy.get(u.id) ?? null, u.id)])), fallback: build(null, null) };
  }

  async page(actor: Actor) {
    this.assertEditor(actor);
    const tenantId = actor.tenantId;
    const [settings, rows, leave, holidays, users] = await Promise.all([
      this.tracking.thresholds(tenantId),
      this.calendarsRepository.find({ where: { tenantId } }),
      this.leaveRepository.find({ where: { tenantId, removedAt: IsNull() }, order: { startDate: 'DESC', id: 'DESC' } }),
      this.holidaysRepository.find({ where: { tenantId }, order: { date: 'ASC' } }),
      this.usersService.findAll(tenantId),
    ]);
    const rowBy = new Map(rows.map((r) => [r.userId, r]));
    const people = users.filter((u) => u.role !== UserRole.CLIENT).sort((a, b) => (a.fullName || a.email).localeCompare(b.fullName || b.email));
    const nameOf = new Map(users.map((u) => [u.id, u.fullName || u.email]));
    return {
      defaults: {
        timeZone: settings.calendarTimeZone,
        workStart: settings.calendarWorkStart,
        workEnd: settings.calendarWorkEnd,
        weekendDays: settings.calendarWeekendDays,
      },
      countries: COUNTRIES.map((c) => ({ value: c, label: COUNTRY_LABEL[c] })),
      people: people.map((u) => {
        const r = rowBy.get(u.id);
        return {
          userId: u.id,
          name: u.fullName || u.email,
          role: u.role,
          own: !!r,
          timeZone: r?.timeZone ?? settings.calendarTimeZone,
          workStart: r?.workStart ?? settings.calendarWorkStart,
          workEnd: r?.workEnd ?? settings.calendarWorkEnd,
          weekendDays: r?.weekendDays ?? settings.calendarWeekendDays,
          country: r?.country ?? null,
        };
      }),
      leave: leave.map((l) => ({ ...l, name: nameOf.get(l.userId) ?? `User #${l.userId}` })),
      holidays,
    };
  }

  async setCalendar(actor: Actor, userId: number, dto: SetPersonCalendarDto) {
    this.assertEditor(actor);
    await this.person(userId, actor.tenantId);
    const problem = calendarProblem(dto);
    if (problem) throw new BadRequestException(problem);
    const before = await this.calendarsRepository.findOne({ where: { tenantId: actor.tenantId, userId } });
    const after = {
      tenantId: actor.tenantId,
      userId,
      timeZone: dto.timeZone,
      workStart: dto.workStart,
      workEnd: dto.workEnd,
      weekendDays: [...dto.weekendDays].sort(),
      country: dto.country ?? null,
      updatedByUserId: actor.id,
      updatedAt: new Date(),
    };
    await this.calendarsRepository.save(after);
    const { updatedAt, updatedByUserId, ...shown } = after;
    await this.audit(actor, WORK_CALENDAR_AUDIT.CALENDAR_SET, userId, { before: before ? { ...before, updatedAt: undefined } : 'default', after: shown });
    return this.page(actor);
  }

  async resetCalendar(actor: Actor, userId: number) {
    this.assertEditor(actor);
    const before = await this.calendarsRepository.findOne({ where: { tenantId: actor.tenantId, userId } });
    if (!before) throw new BadRequestException('This person already uses the default calendar.');
    await this.calendarsRepository.delete({ tenantId: actor.tenantId, userId });
    await this.audit(actor, WORK_CALENDAR_AUDIT.CALENDAR_RESET, userId, { before: { ...before, updatedAt: undefined } });
    return this.page(actor);
  }

  async addLeave(actor: Actor, dto: AddLeaveDto) {
    this.assertEditor(actor);
    await this.person(dto.userId, actor.tenantId);
    if (dto.endDate < dto.startDate) throw new BadRequestException('Leave must end on or after its first day.');
    if (daysBetween(dto.startDate, dto.endDate).length > LEAVE_MAX_DAYS) throw new BadRequestException(`Leave can be at most ${LEAVE_MAX_DAYS} days in one entry.`);
    const overlap = await this.leaveRepository
      .createQueryBuilder('l')
      .where('l."tenantId" = :t AND l."userId" = :u AND l."removedAt" IS NULL AND l."startDate" <= :end AND l."endDate" >= :start', {
        t: actor.tenantId,
        u: dto.userId,
        start: dto.startDate,
        end: dto.endDate,
      })
      .getCount();
    if (overlap) throw new BadRequestException('This overlaps leave already entered for this person.');
    const note = (dto.note || '').trim() || null;
    const saved = await this.leaveRepository.save(
      this.leaveRepository.create({ tenantId: actor.tenantId, userId: dto.userId, startDate: dto.startDate, endDate: dto.endDate, note, createdByUserId: actor.id }),
    );
    await this.audit(actor, WORK_CALENDAR_AUDIT.LEAVE_ADDED, dto.userId, { leaveId: saved.id, startDate: dto.startDate, endDate: dto.endDate, note });
    return this.page(actor);
  }

  async removeLeave(actor: Actor, leaveId: number) {
    this.assertEditor(actor);
    const leave = await this.leaveRepository.findOne({ where: { id: leaveId, tenantId: actor.tenantId } });
    if (!leave) throw new NotFoundException(`Leave #${leaveId} not found`);
    if (leave.removedAt) throw new BadRequestException('This leave is already removed - reload to see it.');
    await this.leaveRepository.update({ id: leave.id }, { removedAt: new Date(), removedByUserId: actor.id });
    await this.audit(actor, WORK_CALENDAR_AUDIT.LEAVE_REMOVED, leave.userId, { leaveId: leave.id, startDate: leave.startDate, endDate: leave.endDate });
    return this.page(actor);
  }

  async addHoliday(actor: Actor, dto: AddCountryHolidayDto) {
    this.assertEditor(actor);
    const name = (dto.name || '').trim();
    if (!name) throw new BadRequestException('Give the holiday a name.');
    try {
      const saved = await this.holidaysRepository.save(this.holidaysRepository.create({ tenantId: actor.tenantId, country: dto.country, date: dto.date, name, createdByUserId: actor.id }));
      await this.audit(actor, WORK_CALENDAR_AUDIT.HOLIDAY_ADDED, actor.id, { holidayId: saved.id, country: dto.country, date: dto.date, name });
    } catch (err: any) {
      if (err?.code === '23505') throw new BadRequestException(`${COUNTRY_LABEL[dto.country]} already has a holiday on ${dto.date}.`);
      throw err;
    }
    return this.page(actor);
  }

  async removeHoliday(actor: Actor, holidayId: number) {
    this.assertEditor(actor);
    const h = await this.holidaysRepository.findOne({ where: { id: holidayId, tenantId: actor.tenantId } });
    if (!h) throw new NotFoundException(`Holiday #${holidayId} not found`);
    await this.holidaysRepository.delete({ id: h.id });
    await this.audit(actor, WORK_CALENDAR_AUDIT.HOLIDAY_REMOVED, actor.id, { holidayId: h.id, country: h.country, date: h.date, name: h.name });
    return this.page(actor);
  }
}

