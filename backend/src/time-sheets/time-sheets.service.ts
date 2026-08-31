import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { TimeEntry } from './time-entry.entity';
import { CreateTimeEntryDto } from './dto/create-time-entry.dto';
import { UpdateTimeEntryDto } from './dto/update-time-entry.dto';
import { IssuesService } from '../issues/issues.service';
import { ProjectsService } from '../projects/projects.service';
import { UserRole } from '../users/user.entity';

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Monday..Sunday, same business-week convention WeeklyReportsService and
// PerformanceDashboardService already use.
function getCurrentWeekRange(): { start: string; end: string } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: toDateString(start), end: toDateString(end) };
}

export interface UserTotal {
  userId: number;
  userEmail: string;
  totalHours: number;
}

export interface TimeSheetReport {
  startDate: string;
  endDate: string;
  totalHours: number;
  byUser: UserTotal[];
  entries: TimeEntry[];
}

@Injectable()
export class TimeSheetsService {
  constructor(
    @InjectRepository(TimeEntry)
    private timeEntriesRepository: Repository<TimeEntry>,
    private issuesService: IssuesService,
    private projectsService: ProjectsService,
  ) {}

  async create(dto: CreateTimeEntryDto, userId: number, userEmail: string, tenantId: number): Promise<TimeEntry> {
    if (!dto.issueId && !dto.projectId) {
      throw new BadRequestException('Log time against a ticket or a project.');
    }

    let issueId: number | undefined;
    let issueTitle: string | undefined;
    let projectId: number | undefined;
    let projectName: string | undefined;

    if (dto.issueId) {
      // The issue is authoritative here - if it belongs to a project, that
      // project is what gets recorded, regardless of what dto.projectId
      // said, so the two can never disagree (simpler than the moduleId/
      // projectId cross-check IssuesService uses, since there's no
      // separate "explicit project" the caller needs to also specify).
      const issue = await this.issuesService.findOne(dto.issueId, tenantId);
      issueId = issue.id;
      issueTitle = issue.title;
      if (issue.projectId) {
        projectId = issue.projectId;
        projectName = issue.projectName;
      }
    } else if (dto.projectId) {
      const project = await this.projectsService.findOne(dto.projectId, tenantId);
      projectId = project.id;
      projectName = project.name;
    }

    const entry = this.timeEntriesRepository.create({
      tenantId,
      userId,
      userEmail,
      issueId,
      issueTitle,
      projectId,
      projectName,
      date: dto.date,
      hours: dto.hours,
      notes: dto.notes,
    });
    return this.timeEntriesRepository.save(entry);
  }

  async findOne(id: number, tenantId: number): Promise<TimeEntry> {
    const entry = await this.timeEntriesRepository.findOne({ where: { id, tenantId } });
    if (!entry) {
      throw new NotFoundException(`Time entry #${id} not found`);
    }
    return entry;
  }

  // Own submission history for a date range - defaults to the current
  // Monday..Sunday week, which is the "weekly summary per user" view.
  findMine(userId: number, tenantId: number, startDate?: string, endDate?: string): Promise<TimeEntry[]> {
    const range = startDate && endDate ? { start: startDate, end: endDate } : getCurrentWeekRange();
    return this.timeEntriesRepository.find({
      where: { userId, tenantId, date: Between(range.start, range.end) },
      order: { date: 'DESC' },
    });
  }

  // Only the person who logged an entry, or an Admin, may edit/delete it -
  // narrower than Dependency's canEdit() on purpose (no Program Manager
  // override) since visibility (the report below) and edit rights are
  // deliberately separate permissions here.
  private canEdit(entry: TimeEntry, user: { id: number; role: UserRole }): boolean {
    return user.role === UserRole.ADMIN || entry.userId === user.id;
  }

  async update(
    id: number,
    dto: UpdateTimeEntryDto,
    currentUser: { id: number; role: UserRole },
    tenantId: number,
  ): Promise<TimeEntry> {
    const entry = await this.findOne(id, tenantId);
    if (!this.canEdit(entry, currentUser)) {
      throw new ForbiddenException('You do not have access to edit this time entry.');
    }
    if (dto.date !== undefined) entry.date = dto.date;
    if (dto.hours !== undefined) entry.hours = dto.hours;
    if (dto.notes !== undefined) entry.notes = dto.notes;
    return this.timeEntriesRepository.save(entry);
  }

  async remove(id: number, currentUser: { id: number; role: UserRole }, tenantId: number): Promise<void> {
    const entry = await this.findOne(id, tenantId);
    if (!this.canEdit(entry, currentUser)) {
      throw new ForbiddenException('You do not have access to delete this time entry.');
    }
    await this.timeEntriesRepository.delete(id);
  }

  // Wide-view (Admin/Executive/Program Manager) aggregated report - per-
  // user totals for the range, plus the raw entries for drill-down.
  // Optional userId/projectId narrow the returned rows, same "narrows
  // display, not who's authorized to call this" convention Performance
  // Dashboard uses for its assigneeEmail filter.
  async getReport(
    tenantId: number,
    startDate?: string,
    endDate?: string,
    userId?: number,
    projectId?: number,
  ): Promise<TimeSheetReport> {
    const range = startDate && endDate ? { start: startDate, end: endDate } : getCurrentWeekRange();
    const where: Record<string, unknown> = { tenantId, date: Between(range.start, range.end) };
    if (userId) where.userId = userId;
    if (projectId) where.projectId = projectId;

    const entries = await this.timeEntriesRepository.find({ where, order: { date: 'DESC' } });

    const totalsByUser = new Map<number, UserTotal>();
    for (const entry of entries) {
      const existing = totalsByUser.get(entry.userId);
      if (existing) {
        existing.totalHours += Number(entry.hours);
      } else {
        totalsByUser.set(entry.userId, { userId: entry.userId, userEmail: entry.userEmail, totalHours: Number(entry.hours) });
      }
    }

    return {
      startDate: range.start,
      endDate: range.end,
      totalHours: entries.reduce((sum, e) => sum + Number(e.hours), 0),
      byUser: Array.from(totalsByUser.values()).sort((a, b) => b.totalHours - a.totalHours),
      entries,
    };
  }
}
