import { Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { ProjectModule } from '../modules/project-module.entity';
import { Phase } from '../phases/phase.entity';
import { BulkImportTasksDto, BulkSpreadsheetFormat } from './dto/bulk-import-tasks.dto';
import { TaskSpreadsheetService, RawTaskRow } from './spreadsheet/task-spreadsheet.service';
import { TaskPriority } from './task-priority.enum';
import { TASK_TITLE_MAX_LENGTH } from './task-title.constants';
import { TasksService } from './tasks.service';
import { UsersService } from '../users/users.service';
import { UserRole, User } from '../users/user.entity';
import { ProjectsService } from '../projects/projects.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

// Export/import (reading the Backlog, generating a template) is the same
// view Admin already gets everywhere else in Tasks (ROLES_ALLOWED_TO_VIEW_BACKLOG
// in TasksController). Import is a mutation - deliberately narrower,
// matching ROLES_ALLOWED_TO_CREATE_TASKS: only Program Manager may create
// tasks, bulk or otherwise; Admin stays view-only across Tasks.
const ROLES_ALLOWED_TO_BULK_EXPORT: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
const ROLES_ALLOWED_TO_BULK_IMPORT: UserRole[] = [UserRole.PROGRAM_MANAGER];

export interface BulkRowError {
  row: number;
  field: string | null;
  message: string;
}

export interface BulkImportResult {
  success: boolean;
  errors: BulkRowError[];
  created?: number[];
}

interface ParsedRow {
  projectId: number;
  projectName: string;
  moduleId: number;
  moduleName: string;
  phaseId: number;
  phaseName: string;
  title: string;
  description: string;
  priority: TaskPriority | null;
  assigneeUserId: number | null;
  assigneeEmail: string | null;
  assigneeRole: UserRole | null;
}

function isValidPriority(value: string, priorityByName: Map<string, TaskPriority>): TaskPriority | undefined {
  return priorityByName.get(value.toLowerCase());
}

@Injectable()
export class TasksBulkService {
  constructor(
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(ProjectModule)
    private modulesRepository: Repository<ProjectModule>,
    @InjectRepository(Phase)
    private phasesRepository: Repository<Phase>,
    @InjectDataSource()
    private dataSource: DataSource,
    private spreadsheetService: TaskSpreadsheetService,
    private tasksService: TasksService,
    private usersService: UsersService,
    private projectsService: ProjectsService,
    private auditLogService: AuditLogService,
  ) {}

  static isAllowedToBulkExport(role: UserRole): boolean {
    return ROLES_ALLOWED_TO_BULK_EXPORT.includes(role);
  }

  static isAllowedToBulkImport(role: UserRole): boolean {
    return ROLES_ALLOWED_TO_BULK_IMPORT.includes(role);
  }

  // Mirrors IssuesBulkService.recordBlockedAttempt() - same shape, same
  // action constant (generic across entities), own entityType.
  async recordBlockedAttempt(user: Pick<User, 'id' | 'email' | 'role' | 'tenantId'>): Promise<void> {
    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: AuditActions.BULK_IMPORT_BLOCKED,
      tenantId: user.tenantId,
      entityType: 'ProjectTask',
      details: {},
    });
  }

  // Only the Task Backlog itself (unassigned tasks) - matches
  // TasksService.findBacklog(), which is the list this feature is meant
  // to round-trip through a spreadsheet.
  async export(tenantId: number, format: BulkSpreadsheetFormat): Promise<{ buffer: Buffer; filename: string }> {
    const tasks = await this.tasksRepository.find({
      where: { tenantId, assigneeUserId: IsNull() },
      order: { id: 'ASC' },
    });
    return this.spreadsheetService.buildExport(tasks, format);
  }

  template(format: BulkSpreadsheetFormat): Promise<{ buffer: Buffer; filename: string }> {
    return this.spreadsheetService.buildTemplate(format);
  }

  async import(
    dto: BulkImportTasksDto,
    currentUser: Pick<User, 'id' | 'email' | 'role' | 'tenantId'>,
  ): Promise<BulkImportResult> {
    const rawRows = await this.spreadsheetService.parseImport(dto.fileBase64, dto.format);
    if (rawRows.length === 0) {
      return { success: false, errors: [{ row: 0, field: null, message: 'No rows found in the uploaded file.' }] };
    }

    const { errors, parsedRows } = await this.validateRows(rawRows, currentUser.tenantId);
    if (errors.length > 0) {
      await this.auditLogService.record({
        userId: currentUser.id,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        action: AuditActions.BULK_IMPORT_VALIDATION_FAILED,
        tenantId: currentUser.tenantId,
        entityType: 'ProjectTask',
        details: { totalRows: rawRows.length, errorCount: errors.length },
      });
      return { success: false, errors };
    }

    // All rows already validated (including that every referenced
    // Project/Module/Phase/Assignee exists) - the transaction wraps the
    // write loop only as defense-in-depth against an unexpected mid-batch
    // DB error, same reasoning as IssuesBulkService.import(). Nothing is
    // written unless every row in the file is clean.
    const createdIds = await this.dataSource.transaction(async (manager) => {
      const tasksRepo = manager.getRepository(ProjectTask);
      const created: number[] = [];
      for (const row of parsedRows) {
        const task = tasksRepo.create({
          projectId: row.projectId,
          projectName: row.projectName,
          moduleId: row.moduleId,
          moduleName: row.moduleName,
          phaseId: row.phaseId,
          phaseName: row.phaseName,
          title: row.title,
          description: row.description,
          assigneeUserId: row.assigneeUserId,
          assigneeEmail: row.assigneeEmail,
          estimatedHours: null,
          dueDate: null,
          status: 'Development',
          peerReviewEnabled: this.tasksService.requiresPeerReviewForAssignee(row.assigneeRole ?? undefined),
          priority: row.priority,
          createdByUserId: currentUser.id,
          createdByEmail: currentUser.email,
          tenantId: currentUser.tenantId,
        });
        const saved = await tasksRepo.save(task);
        created.push(saved.id);
      }
      return created;
    });

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.BULK_IMPORT_COMPLETED,
      tenantId: currentUser.tenantId,
      entityType: 'ProjectTask',
      details: { createdCount: createdIds.length },
    });

    return { success: true, errors: [], created: createdIds };
  }

  // Validates every row independently and collects every error found -
  // never stops at the first bad row, and never writes anything itself.
  // Rows are only usable (returned in parsedRows) once the whole batch is
  // clean; the caller discards parsedRows entirely if errors is non-empty.
  private async validateRows(
    rawRows: RawTaskRow[],
    tenantId: number,
  ): Promise<{ errors: BulkRowError[]; parsedRows: ParsedRow[] }> {
    const errors: BulkRowError[] = [];
    const parsedRows: ParsedRow[] = [];

    const [allProjects, allModules, allPhases] = await Promise.all([
      this.projectsService.findAll(tenantId),
      this.modulesRepository.find({ where: { tenantId } }),
      this.phasesRepository.find({ where: { tenantId } }),
    ]);
    const projectByName = new Map(allProjects.map((p) => [p.name.toLowerCase(), p]));
    // Deactivated modules/phases are treated the same as one that doesn't
    // exist - a bulk-imported row shouldn't attach to a retired
    // module/phase any more than the Create Task form's dropdowns would
    // offer one.
    const moduleByProjectAndName = new Map(
      allModules.filter((m) => m.isActive).map((m) => [`${m.projectId}::${m.name.toLowerCase()}`, m]),
    );
    const phaseByModuleAndName = new Map(
      allPhases.filter((p) => p.isActive).map((p) => [`${p.moduleId}::${p.name.toLowerCase()}`, p]),
    );
    const priorityByName = new Map(Object.values(TaskPriority).map((p) => [p.toLowerCase(), p]));

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNumber = i + 2; // +1 for 0-index, +1 for the header row itself
      const push = (field: string, message: string) => errors.push({ row: rowNumber, field, message });

      const projectNameRaw = row['Project']?.trim();
      let project: { id: number; name: string } | null = null;
      if (!projectNameRaw) {
        push('Project', 'Project is required.');
      } else {
        const match = projectByName.get(projectNameRaw.toLowerCase());
        if (!match) {
          push('Project', `Unknown project "${projectNameRaw}".`);
        } else {
          project = { id: match.id, name: match.name };
        }
      }

      const moduleNameRaw = row['Module']?.trim();
      let module: { id: number; name: string } | null = null;
      if (!moduleNameRaw) {
        push('Module', 'Module is required.');
      } else if (project) {
        const match = moduleByProjectAndName.get(`${project.id}::${moduleNameRaw.toLowerCase()}`);
        if (!match) {
          push('Module', `Unknown module "${moduleNameRaw}" for project "${project.name}".`);
        } else {
          module = { id: match.id, name: match.name };
        }
      }

      const phaseNameRaw = row['Phase']?.trim();
      let phase: { id: number; name: string } | null = null;
      if (!phaseNameRaw) {
        push('Phase', 'Phase is required.');
      } else if (module) {
        const match = phaseByModuleAndName.get(`${module.id}::${phaseNameRaw.toLowerCase()}`);
        if (!match) {
          push('Phase', `Unknown phase "${phaseNameRaw}" for module "${module.name}".`);
        } else {
          phase = { id: match.id, name: match.name };
        }
      }

      const title = row['Title']?.trim();
      if (!title) {
        push('Title', 'Title is required.');
      } else if (title.length > TASK_TITLE_MAX_LENGTH) {
        push('Title', `Title must be ${TASK_TITLE_MAX_LENGTH} characters or fewer.`);
      }

      const priorityRaw = row['Priority']?.trim();
      let priority: TaskPriority | null = null;
      if (priorityRaw) {
        const match = isValidPriority(priorityRaw, priorityByName);
        if (!match) {
          push('Priority', `"${priorityRaw}" is not a valid priority - must be one of: ${Object.values(TaskPriority).join(', ')}`);
        } else {
          priority = match;
        }
      }

      const assigneeRaw = row['Assignee']?.trim();
      let assignee: { id: number; email: string; role: UserRole } | null = null;
      if (assigneeRaw) {
        // Exact-email match only, same precedent IssuesBulkService uses
        // for Dependency Owner - no fuzzy/name matching. No role
        // restriction here either, matching TasksService.create()'s own
        // permissiveness (the Create Task form's dropdown is what
        // curates the roles a PM would normally pick from; bulk import
        // reuses the same unrestricted backend rule rather than a
        // stricter one of its own).
        const match = await this.usersService.findByEmailAndTenant(assigneeRaw, tenantId);
        if (!match) {
          push('Assignee', `No user found with email "${assigneeRaw}".`);
        } else {
          assignee = { id: match.id, email: match.email, role: match.role };
        }
      }

      if (project && module && phase && title) {
        parsedRows.push({
          projectId: project.id,
          projectName: project.name,
          moduleId: module.id,
          moduleName: module.name,
          phaseId: phase.id,
          phaseName: phase.name,
          title,
          description: row['Description']?.trim() || '',
          priority,
          assigneeUserId: assignee?.id ?? null,
          assigneeEmail: assignee?.email ?? null,
          assigneeRole: assignee?.role ?? null,
        });
      }
    }

    return { errors, parsedRows: errors.length === 0 ? parsedRows : [] };
  }
}
