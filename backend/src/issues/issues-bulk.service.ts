import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Issue, IssueMode, IssueStatus } from './issue.entity';
import { ProjectModule } from '../modules/project-module.entity';
import { BulkImportIssuesDto, BulkSpreadsheetFormat } from './dto/bulk-import-issues.dto';
import { IssueSpreadsheetService, RawIssueRow } from './spreadsheet/issue-spreadsheet.service';
import { UsersService } from '../users/users.service';
import { UserRole, User } from '../users/user.entity';
import { ProjectsService } from '../projects/projects.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

// Only these two roles may bulk import/export - deliberately a separate,
// narrower list from IssuesService.ROLES_ALLOWED_TO_CREATE_TICKETS (which
// also includes QA/Executive/Client), confirmed with the user during
// planning rather than assumed.
const ROLES_ALLOWED_TO_BULK_IMPORT_EXPORT: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

export interface BulkRowError {
  row: number;
  field: string | null;
  message: string;
}

export interface BulkImportResult {
  success: boolean;
  errors: BulkRowError[];
  created?: number[];
  updated?: number[];
}

interface ParsedRow {
  rowNumber: number;
  issueId: number | null; // null => create
  projectId: number;
  projectName: string;
  moduleId: number | null;
  moduleName: string | null;
  title: string;
  description: string | null;
  estimatedHours: number | null;
  dueDate: string | null;
  targetDate: string | null;
  dependencyText: string | null;
  dependencyOwnerUserId: number | null;
  dependencyOwnerEmail: string | null;
  status: IssueStatus;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

@Injectable()
export class IssuesBulkService {
  constructor(
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    @InjectRepository(ProjectModule)
    private modulesRepository: Repository<ProjectModule>,
    @InjectDataSource()
    private dataSource: DataSource,
    private spreadsheetService: IssueSpreadsheetService,
    private usersService: UsersService,
    private projectsService: ProjectsService,
    private auditLogService: AuditLogService,
  ) {}

  static isAllowedToBulkImportExport(role: UserRole): boolean {
    return ROLES_ALLOWED_TO_BULK_IMPORT_EXPORT.includes(role);
  }

  // Mirrors IssuesService.recordBlockedCreationAttempt() - same shape, own
  // action constant, since bulk import/export is a separate authorization
  // boundary from ticket creation.
  async recordBlockedAttempt(user: Pick<User, 'id' | 'email' | 'role' | 'tenantId'>): Promise<void> {
    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: AuditActions.BULK_IMPORT_BLOCKED,
      tenantId: user.tenantId,
      entityType: 'Issue',
      details: {},
    });
  }

  async export(
    tenantId: number,
    format: BulkSpreadsheetFormat,
    projectId?: number,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const issues = await this.issuesRepository.find({
      where: projectId ? { tenantId, projectId } : { tenantId },
      order: { id: 'ASC' },
    });
    return this.spreadsheetService.buildExport(issues, format);
  }

  template(format: BulkSpreadsheetFormat): Promise<{ buffer: Buffer; filename: string }> {
    return this.spreadsheetService.buildTemplate(format);
  }

  async import(
    dto: BulkImportIssuesDto,
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
        entityType: 'Issue',
        details: { totalRows: rawRows.length, errorCount: errors.length },
      });
      return { success: false, errors };
    }

    // All rows already validated (including that every referenced Issue
    // ID/Project/Module/Dependency Owner exists) - the transaction wraps
    // the write loop only as defense-in-depth against an unexpected
    // mid-batch DB error, not because failures are expected here. Nothing
    // is written unless every row in the file is clean.
    const { createdIds, updatedIds } = await this.dataSource.transaction(async (manager) => {
      const issuesRepo = manager.getRepository(Issue);
      const created: number[] = [];
      const updated: number[] = [];

      for (const row of parsedRows) {
        const fields = {
          title: row.title,
          description: row.description,
          status: row.status,
          projectId: row.projectId,
          projectName: row.projectName,
          moduleId: row.moduleId,
          moduleName: row.moduleName,
          estimatedHours: row.estimatedHours,
          dueDate: row.dueDate,
          targetDate: row.targetDate,
          dependencyText: row.dependencyText,
          dependencyOwnerUserId: row.dependencyOwnerUserId,
          dependencyOwnerEmail: row.dependencyOwnerEmail,
        };

        if (row.issueId == null) {
          const issue = issuesRepo.create({
            ...fields,
            createdByUserId: currentUser.id,
            createdByEmail: currentUser.email,
            mode: IssueMode.MANUAL,
            tenantId: currentUser.tenantId,
          });
          const saved = await issuesRepo.save(issue);
          created.push(saved.id);
        } else {
          await issuesRepo.update({ id: row.issueId, tenantId: currentUser.tenantId }, fields);
          updated.push(row.issueId);
        }
      }

      return { createdIds: created, updatedIds: updated };
    });

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.BULK_IMPORT_COMPLETED,
      tenantId: currentUser.tenantId,
      entityType: 'Issue',
      details: { createdCount: createdIds.length, updatedCount: updatedIds.length },
    });

    return { success: true, errors: [], created: createdIds, updated: updatedIds };
  }

  // Validates every row independently and collects every error found -
  // never stops at the first bad row, and never writes anything itself.
  // Rows are only usable (returned in parsedRows) once the whole batch is
  // clean; the caller discards parsedRows entirely if errors is non-empty.
  private async validateRows(
    rawRows: RawIssueRow[],
    tenantId: number,
  ): Promise<{ errors: BulkRowError[]; parsedRows: ParsedRow[] }> {
    const errors: BulkRowError[] = [];
    const parsedRows: ParsedRow[] = [];

    const [allProjects, allModules] = await Promise.all([
      this.projectsService.findAll(tenantId),
      this.modulesRepository.find({ where: { tenantId } }),
    ]);
    const projectByName = new Map(allProjects.map((p) => [p.name.toLowerCase(), p]));
    const moduleByProjectAndName = new Map(
      allModules.map((m) => [`${m.projectId}::${m.name.toLowerCase()}`, m]),
    );
    const validStatuses = new Map(Object.values(IssueStatus).map((s) => [s.toLowerCase(), s]));

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNumber = i + 2; // +1 for 0-index, +1 for the header row itself
      const push = (field: string, message: string) => errors.push({ row: rowNumber, field, message });

      const issueIdRaw = row['Issue ID']?.trim();
      let issueId: number | null = null;
      let existingIssue: Issue | null = null;
      if (issueIdRaw) {
        if (!/^\d+$/.test(issueIdRaw)) {
          push('Issue ID', `"${issueIdRaw}" is not a whole number.`);
        } else {
          issueId = Number(issueIdRaw);
          existingIssue = await this.issuesRepository.findOne({ where: { id: issueId, tenantId } });
          if (!existingIssue) {
            push('Issue ID', `Issue #${issueId} was not found.`);
          }
        }
      }

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
      if (moduleNameRaw && project) {
        const match = moduleByProjectAndName.get(`${project.id}::${moduleNameRaw.toLowerCase()}`);
        if (!match) {
          push('Module', `Unknown module "${moduleNameRaw}" for project "${project.name}".`);
        } else {
          module = { id: match.id, name: match.name };
        }
      }

      const title = row['Issue Title']?.trim();
      if (!title) {
        push('Issue Title', 'Issue Title is required.');
      }

      const estimatedHoursRaw = row['Estimated Hours']?.trim();
      let estimatedHours: number | null = null;
      if (estimatedHoursRaw) {
        const n = Number(estimatedHoursRaw);
        if (Number.isNaN(n) || n < 0) {
          push('Estimated Hours', `"${estimatedHoursRaw}" is not a valid non-negative number.`);
        } else {
          estimatedHours = n;
        }
      }

      const dueDateRaw = row['Due Date']?.trim();
      let dueDate: string | null = null;
      if (dueDateRaw) {
        if (!isValidIsoDate(dueDateRaw)) {
          push('Due Date', `"${dueDateRaw}" is not a valid date - use YYYY-MM-DD.`);
        } else {
          dueDate = dueDateRaw;
        }
      }

      const targetDateRaw = row['Target Date']?.trim();
      let targetDate: string | null = null;
      if (targetDateRaw) {
        if (!isValidIsoDate(targetDateRaw)) {
          push('Target Date', `"${targetDateRaw}" is not a valid date - use YYYY-MM-DD.`);
        } else {
          targetDate = targetDateRaw;
        }
      }

      const dependencyOwnerRaw = row['Dependency Owner']?.trim();
      let dependencyOwner: { id: number; email: string } | null = null;
      if (dependencyOwnerRaw) {
        // Exact-email match only, same precedent the Teams @mention flow
        // ultimately relies on (TeamsMessageConverterService resolves a
        // structured Graph identity to an email, then does exactly this
        // lookup) - no fuzzy/name matching.
        const match = await this.usersService.findByEmailAndTenant(dependencyOwnerRaw, tenantId);
        if (!match) {
          push('Dependency Owner', `No user found with email "${dependencyOwnerRaw}".`);
        } else {
          dependencyOwner = { id: match.id, email: match.email };
        }
      }

      const statusRaw = row['Status']?.trim();
      let status: IssueStatus | null = null;
      if (!statusRaw) {
        push('Status', 'Status is required.');
      } else {
        const match = validStatuses.get(statusRaw.toLowerCase());
        if (!match) {
          push('Status', `"${statusRaw}" is not a valid status - must be one of: ${Object.values(IssueStatus).join(', ')}`);
        } else {
          status = match;
        }
      }

      if (project && title && status) {
        parsedRows.push({
          rowNumber,
          issueId,
          projectId: project.id,
          projectName: project.name,
          moduleId: module?.id ?? null,
          moduleName: module?.name ?? null,
          title,
          description: row['Description']?.trim() || null,
          estimatedHours,
          dueDate,
          targetDate,
          dependencyText: row['Dependency']?.trim() || null,
          dependencyOwnerUserId: dependencyOwner?.id ?? null,
          dependencyOwnerEmail: dependencyOwner?.email ?? null,
          status,
        });
      }
    }

    return { errors, parsedRows: errors.length === 0 ? parsedRows : [] };
  }
}
