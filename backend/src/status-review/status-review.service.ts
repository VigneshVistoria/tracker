import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskBlockingDefect } from '../tasks/task-blocking-defect.entity';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { UsersService } from '../users/users.service';
import { computeStatusReview, StatusReviewSummary, WORK_ITEM_STATUSES } from './status-review.compute';

// Same "resolved" set TasksService.findOpenBlockingDefects() uses - kept as
// a copy rather than importing/changing TasksService, since Status Review
// is deliberately additive (no edits to existing Team Tasks logic).
const BLOCKING_DEFECT_RESOLVED_STATUSES = ['Pass', 'Junk', 'Closed'];

// Read-only. Loads the tenant's work items, their open dependency tickets
// and blocking defects, and hands them to computeStatusReview() - all
// counting lives there.
@Injectable()
export class StatusReviewService {
  constructor(
    @InjectRepository(ProjectTask) private readonly tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TaskDependencyTicket) private readonly ticketsRepository: Repository<TaskDependencyTicket>,
    @InjectRepository(TaskBlockingDefect) private readonly blockingRepository: Repository<TaskBlockingDefect>,
    private readonly usersService: UsersService,
  ) {}

  async getSummary(tenantId: number): Promise<StatusReviewSummary> {
    const tasks = await this.tasksRepository.find({
      where: { tenantId, assigneeUserId: Not(IsNull()), status: In(WORK_ITEM_STATUSES) },
    });
    const taskIds = tasks.map((t) => t.id);

    const openDependencies = taskIds.length
      ? await this.ticketsRepository.find({ where: { tenantId, status: 'open', parentTaskId: In(taskIds) } })
      : [];

    const blockedTaskIds = await this.findBlockedTaskIds(tenantId, taskIds);

    const users = await this.usersService.findAll(tenantId);
    const userNames = new Map(users.map((u) => [u.id, u.fullName || u.email]));

    return computeStatusReview({
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assigneeUserId: t.assigneeUserId,
        dueDate: t.dueDate,
        isDefect: t.isDefect,
        priority: t.priority,
        projectName: t.projectName,
        moduleName: t.moduleName,
      })),
      openDependencies: openDependencies.map((d) => ({
        id: d.id,
        title: d.title,
        parentTaskId: d.parentTaskId,
        ownerUserId: d.ownerUserId,
        createdByUserId: d.createdByUserId,
        createdByEmail: d.createdByEmail,
        createdAt: d.createdAt,
      })),
      blockedTaskIds,
      userNames,
      today: new Date().toISOString().slice(0, 10),
    });
  }

  // A task is blocked by an unresolved defect that was either spun off it
  // (defect.parentTaskId) or linked to it via task_blocking_defects - the
  // same two sources TasksService.findOpenBlockingDefects() checks.
  private async findBlockedTaskIds(tenantId: number, taskIds: number[]): Promise<number[]> {
    if (taskIds.length === 0) return [];
    const blocked = new Set<number>();

    const spunOff = await this.tasksRepository.find({
      where: { tenantId, isDefect: true, parentTaskId: In(taskIds), status: Not(In(BLOCKING_DEFECT_RESOLVED_STATUSES)) },
      select: ['id', 'parentTaskId'],
    });
    for (const d of spunOff) blocked.add(d.parentTaskId);

    const links = await this.blockingRepository.find({ where: { tenantId, taskId: In(taskIds) } });
    if (links.length > 0) {
      const openLinked = await this.tasksRepository.find({
        where: {
          tenantId,
          isDefect: true,
          id: In([...new Set(links.map((l) => l.defectId))]),
          status: Not(In(BLOCKING_DEFECT_RESOLVED_STATUSES)),
        },
        select: ['id'],
      });
      const openIds = new Set(openLinked.map((d) => d.id));
      for (const l of links) if (openIds.has(l.defectId)) blocked.add(l.taskId);
    }
    return Array.from(blocked);
  }
}
