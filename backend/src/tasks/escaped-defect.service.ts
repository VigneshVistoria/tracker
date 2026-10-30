import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { Project } from '../projects/project.entity';
import { TasksService } from './tasks.service';
import { User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TEAM_SETTINGS_DEFAULTS, dateInZone, isValidTimeZone } from '../team-settings/time-zone';
import { ESCAPED_DEFECT_AUDIT, ESCAPED_DEFECT_ROLES, releaseDateProblem } from './escaped-defect';
import { UpdateEscapedDefectDto } from './dto/escaped-defect.dto';

// Performance Tracking Q4 - "Found in production" on a defect. See
// ./escaped-defect.ts.
@Injectable()
export class EscapedDefectService {
  constructor(
    private tasksService: TasksService,
    private auditLogService: AuditLogService,
    private dataSource: DataSource,
  ) {}

  private async trackingOn(projectId: number, tenantId: number) {
    const project = await this.dataSource.getRepository(Project).findOne({ where: { id: projectId, tenantId } });
    return !!project?.performanceTrackingEnabled;
  }

  private async viewable(taskId: number, user: User, tenantId: number) {
    const task = await this.tasksService.findOne(taskId, tenantId);
    if (!(await this.tasksService.canView(task, user))) throw new ForbiddenException('You do not have access to this task.');
    return task;
  }

  // The source task's first Release Log date (latest release on or before
  // `onOrBefore`), or null.
  async releaseLogDate(taskId: number, tenantId: number, onOrBefore: string): Promise<string | null> {
    const [row] = await this.dataSource.query(
      `SELECT MAX(r."releaseDate")::text AS d FROM release_items i JOIN releases r ON r.id = i."releaseId"
        WHERE i."tenantId" = $1 AND i."taskId" = $2 AND r."releaseDate" <= $3::date`,
      [tenantId, taskId, onOrBefore],
    );
    return row?.d ?? null;
  }

  async state(taskId: number, user: User, tenantId: number) {
    const task = await this.viewable(taskId, user, tenantId);
    const trackingOn = task.isDefect && (await this.trackingOn(task.projectId, tenantId));
    const source = task.escapedFromTaskId ? await this.tasksService.findOne(task.escapedFromTaskId, tenantId).catch(() => null) : null;
    const marker = task.foundInProductionByUserId
      ? await this.dataSource.query(`SELECT "fullName", email FROM users WHERE id = $1 AND "tenantId" = $2`, [task.foundInProductionByUserId, tenantId])
      : [];
    return {
      isDefect: task.isDefect,
      trackingOn,
      foundInProduction: task.foundInProduction,
      escapedFromTaskId: task.escapedFromTaskId,
      escapedFromTaskTitle: source?.title ?? null,
      productionReleaseDate: task.productionReleaseDate,
      markedAt: task.foundInProductionAt,
      markedByName: marker[0] ? marker[0].fullName || marker[0].email : null,
      canEdit: trackingOn && task.status !== 'Junk' && ESCAPED_DEFECT_ROLES.includes(user.role),
    };
  }

  async update(taskId: number, dto: UpdateEscapedDefectDto, user: User, tenantId: number) {
    if (!ESCAPED_DEFECT_ROLES.includes(user.role)) throw new ForbiddenException('Only QA, a Program Manager or an Admin can mark a defect as found in production.');
    const task = await this.viewable(taskId, user, tenantId);
    if (!task.isDefect) throw new BadRequestException('Only a defect can be marked as found in production.');
    this.tasksService.assertNotJunk(task);
    if (!(await this.trackingOn(task.projectId, tenantId))) throw new BadRequestException('Performance Tracking is off for this project.');

    let changes: Partial<ProjectTask>;
    if (!dto.foundInProduction) {
      if (!task.foundInProduction) return this.state(taskId, user, tenantId);
      changes = { foundInProduction: false, escapedFromTaskId: null, productionReleaseDate: null, foundInProductionByUserId: null, foundInProductionAt: null };
    } else {
      const settings = await this.dataSource.getRepository(TeamSettings).findOne({ where: { tenantId } });
      const timeZone = isValidTimeZone(settings?.timeZone) ? settings!.timeZone : TEAM_SETTINGS_DEFAULTS.timeZone;
      const foundOn = dateInZone(task.createdAt ?? new Date(), timeZone);
      const sourceId = dto.escapedFromTaskId === undefined ? task.escapedFromTaskId : dto.escapedFromTaskId;
      if (sourceId !== null && sourceId !== undefined) {
        if (sourceId === task.id) throw new BadRequestException('A defect cannot escape from itself.');
        const source = await this.tasksService.findOne(sourceId, tenantId).catch(() => null);
        if (!source || source.projectId !== task.projectId) throw new BadRequestException(`Task #${sourceId} is not in this project.`);
        if (source.status === 'Junk') throw new BadRequestException(`Task #${sourceId} is in Junk.`);
      }
      let releaseDate = (dto.productionReleaseDate ?? '').trim() || null;
      if (!releaseDate && dto.productionReleaseDate === undefined) releaseDate = task.productionReleaseDate;
      if (!releaseDate && sourceId) releaseDate = await this.releaseLogDate(sourceId, tenantId, foundOn);
      if (!releaseDate) throw new BadRequestException('Enter the release date - the source task has no Release Log entry to take it from.');
      const problem = releaseDateProblem(releaseDate, foundOn);
      if (problem) throw new BadRequestException(problem);
      changes = {
        foundInProduction: true,
        escapedFromTaskId: sourceId ?? null,
        productionReleaseDate: releaseDate,
        ...(task.foundInProduction ? {} : { foundInProductionByUserId: user.id, foundInProductionAt: new Date() }),
      };
    }
    const keys = Object.keys(changes) as (keyof ProjectTask)[];
    if (keys.every((k) => String((task as any)[k] ?? null) === String((changes as any)[k] ?? null))) return this.state(taskId, user, tenantId);
    const before = Object.fromEntries(['foundInProduction', 'escapedFromTaskId', 'productionReleaseDate'].map((k) => [k, (task as any)[k] ?? null]));
    await this.dataSource.transaction(async (em) => {
      await em.update(ProjectTask, { id: task.id, tenantId }, changes);
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: ESCAPED_DEFECT_AUDIT.MARKED,
        tenantId,
        entityType: 'ProjectTask',
        entityId: task.id,
        details: { before, after: { foundInProduction: changes.foundInProduction, escapedFromTaskId: changes.escapedFromTaskId ?? null, productionReleaseDate: changes.productionReleaseDate ?? null } },
      });
    });
    return this.state(taskId, user, tenantId);
  }
}
