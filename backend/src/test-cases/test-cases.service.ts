import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TestCase, TestCaseReviewStatus, TestCaseStatus } from './test-case.entity';
import { TestExecution, TestResult } from './test-execution.entity';
import { CreateTestCaseDto } from './dto/create-test-case.dto';
import { UpdateTestCaseDto } from './dto/update-test-case.dto';
import { CreateTestExecutionDto } from './dto/create-test-execution.dto';
import { Priority } from '../common/priority.enum';
import { IssueCategory } from '../issues/issue.entity';
import { ProjectsService } from '../projects/projects.service';
import { ModulesService } from '../modules/modules.service';
import { PhasesService } from '../phases/phases.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { UserRole } from '../users/user.entity';
import { LabelsService } from '../labels/labels.service';
import { TestCaseCustomFieldsService, CustomFieldValues } from './test-case-custom-fields.service';
import { TestCaseCustomField, CustomFieldType } from './test-case-custom-field.entity';
import { BulkImportTestCasesDto, TestCaseSpreadsheetFormat } from './dto/bulk-import-test-cases.dto';
import {
  BUILT_IN_COLUMNS,
  BuiltInColumn,
  REQUIRED_COLUMNS,
  builtInColumnFor,
  isExportOnlyHeader,
  normalizeHeader,
} from './test-case-columns';
import { parseSpreadsheet, writeSpreadsheet, SpreadsheetSpec } from './test-case-spreadsheet';

export interface BulkImportRowProblem {
  row: number;
  title?: string;
  message: string;
}

export interface BulkImportPreviewRow {
  row: number;
  title: string;
  projectName: string | null;
  moduleName: string | null;
  phaseName: string | null;
  priority: string | null;
  labels: string[];
  customFieldCount: number;
}

export interface BulkImportResult {
  dryRun: boolean;
  totalRows: number;
  // Rows that will be (dry run) / were (real import) created.
  toImport: BulkImportPreviewRow[];
  created: { id: number; caseNumber: string; title: string }[];
  // Valid rows deliberately not imported because the test case already
  // exists - not errors, nothing for the user to fix.
  skipped: BulkImportRowProblem[];
  errors: BulkImportRowProblem[];
  // File-level notes, e.g. a column that didn't match any field.
  warnings: string[];
}

// Duplicate key for "is this the same test case": same project (or both
// without one) and the same title, ignoring case and repeated spaces.
function duplicateKey(projectId: number | null | undefined, title: string): string {
  return `${projectId ?? 'none'}::${title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

// The fields a PM actually signs off on - changing any of these on a Ready
// for Execution case sends it back to Draft (see update()). Title,
// priority, category, project/module/phase are metadata and don't.
const REVIEWED_CONTENT_FIELDS = ['preconditions', 'steps', 'expectedResult'] as const;

type ReviewActor = { id: number; email: string; role: UserRole };

type ResolvedChain = {
  project: { id: number; name: string } | null;
  module: { id: number; name: string } | null;
  phase: { id: number; name: string } | null;
};

@Injectable()
export class TestCasesService {
  constructor(
    @InjectRepository(TestCase)
    private testCasesRepository: Repository<TestCase>,
    @InjectRepository(TestExecution)
    private executionsRepository: Repository<TestExecution>,
    private projectsService: ProjectsService,
    private modulesService: ModulesService,
    private phasesService: PhasesService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
    private labelsService: LabelsService,
    private customFieldsService: TestCaseCustomFieldsService,
  ) {}

  // Every id must be a label in this tenant; newly-added ones must also
  // be active. Labels already on the case stay allowed even if they've
  // since been deactivated, so editing an old case doesn't force
  // stripping them.
  private async resolveLabelIds(labelIds: number[], existing: number[], tenantId: number): Promise<number[]> {
    const unique = [...new Set(labelIds)];
    if (unique.length === 0) return [];
    const labels = await this.labelsService.findAll(tenantId);
    const byId = new Map(labels.map((l) => [l.id, l]));
    for (const id of unique) {
      const label = byId.get(id);
      if (!label) throw new BadRequestException(`Label #${id} not found.`);
      if (!label.isActive && !existing.includes(id)) {
        throw new BadRequestException(`Label "${label.name}" is inactive and can't be added.`);
      }
    }
    return unique;
  }

  findAll(tenantId: number, projectId?: number): Promise<TestCase[]> {
    return this.testCasesRepository.find({
      where: projectId ? { projectId, tenantId } : { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number, tenantId: number): Promise<TestCase> {
    const testCase = await this.testCasesRepository.findOne({ where: { id, tenantId } });
    if (!testCase) {
      throw new NotFoundException(`Test case #${id} not found`);
    }
    return testCase;
  }

  private async resolveProject(projectId: number | undefined, tenantId: number): Promise<{ id: number; name: string } | null> {
    if (projectId === undefined) return null;
    const project = await this.projectsService.findOne(projectId, tenantId);
    return { id: project.id, name: project.name };
  }

  // Same "plain FK + denormalized name" resolution TasksService.
  // resolveChain() does for ProjectTask, relaxed to match TestCase's own
  // optionality: Project/Module/Phase are each optional on a test case
  // (unlike ProjectTask, where all three are mandatory together), but a
  // Module still has to belong to the given Project and a Phase still has
  // to belong to the given Module whenever they're supplied.
  private async resolveProjectModulePhase(
    ids: { projectId?: number; moduleId?: number; phaseId?: number },
    tenantId: number,
  ): Promise<ResolvedChain> {
    const project = await this.resolveProject(ids.projectId, tenantId);

    let module: { id: number; name: string } | null = null;
    if (ids.moduleId !== undefined) {
      const found = await this.modulesService.findOne(ids.moduleId, tenantId);
      if (project && found.projectId !== project.id) {
        throw new BadRequestException(`Module #${ids.moduleId} belongs to a different project.`);
      }
      module = { id: found.id, name: found.name };
    }

    let phase: { id: number; name: string } | null = null;
    if (ids.phaseId !== undefined) {
      if (!module) {
        throw new BadRequestException('A Module must be set before a Phase can be set.');
      }
      const found = await this.phasesService.findOne(ids.phaseId, tenantId);
      if (found.moduleId !== module.id) {
        throw new BadRequestException(`Phase #${ids.phaseId} belongs to a different module.`);
      }
      phase = { id: found.id, name: found.name };
    }

    return { project, module, phase };
  }

  // Sets the human-readable caseNumber ("TC-0001") from the row's own id
  // - can only happen after the first save, once id exists. Called once,
  // right after create()/bulkImport() first insert a row.
  private async assignCaseNumber(testCase: TestCase): Promise<TestCase> {
    testCase.caseNumber = `TC-${String(testCase.id).padStart(4, '0')}`;
    return this.testCasesRepository.save(testCase);
  }

  async create(dto: CreateTestCaseDto, userId: number, userEmail: string, tenantId: number): Promise<TestCase> {
    const { project, module, phase } = await this.resolveProjectModulePhase(
      { projectId: dto.projectId, moduleId: dto.moduleId, phaseId: dto.phaseId },
      tenantId,
    );
    const fields = await this.customFieldsService.findAll(tenantId);
    const customFields = this.customFieldsService.resolveValues(fields, dto.customFields, {}, true);
    const labelIds = await this.resolveLabelIds(dto.labelIds || [], [], tenantId);
    const testCase = this.testCasesRepository.create({
      title: dto.title,
      description: dto.description,
      preconditions: dto.preconditions,
      steps: dto.steps,
      expectedResult: dto.expectedResult,
      priority: dto.priority,
      category: dto.category,
      projectId: project?.id,
      projectName: project?.name,
      moduleId: module?.id,
      moduleName: module?.name,
      phaseId: phase?.id,
      phaseName: phase?.name,
      customFields,
      labelIds,
      createdByUserId: userId,
      createdByEmail: userEmail,
      tenantId,
    });
    const saved = await this.testCasesRepository.save(testCase);
    return this.assignCaseNumber(saved);
  }

  async update(id: number, dto: UpdateTestCaseDto, tenantId: number): Promise<TestCase> {
    const testCase = await this.findOne(id, tenantId);

    const changedContentFields = REVIEWED_CONTENT_FIELDS.filter(
      // ?? '' so an empty textarea ('') vs a never-set column (null)
      // doesn't count as a content change.
      (field) => dto[field] !== undefined && (dto[field] ?? '') !== (testCase[field] ?? ''),
    );
    if (changedContentFields.length > 0) {
      if (testCase.reviewStatus === TestCaseReviewStatus.PENDING_REVIEW) {
        throw new BadRequestException(
          'This test case is waiting for PM review - its preconditions, steps and expected result cannot be edited until the PM approves or rejects it.',
        );
      }
      if (testCase.reviewStatus === TestCaseReviewStatus.READY_FOR_EXECUTION) {
        testCase.reviewStatus = TestCaseReviewStatus.DRAFT;
      }
    }

    if (dto.title !== undefined) testCase.title = dto.title;
    if (dto.description !== undefined) testCase.description = dto.description;
    if (dto.preconditions !== undefined) testCase.preconditions = dto.preconditions;
    if (dto.steps !== undefined) testCase.steps = dto.steps;
    if (dto.expectedResult !== undefined) testCase.expectedResult = dto.expectedResult;
    if (dto.priority !== undefined) testCase.priority = dto.priority;
    if (dto.category !== undefined) testCase.category = dto.category;
    if (dto.status !== undefined) testCase.status = dto.status;
    if (dto.labelIds !== undefined) {
      testCase.labelIds = await this.resolveLabelIds(dto.labelIds, testCase.labelIds || [], tenantId);
    }
    if (dto.customFields !== undefined) {
      const fields = await this.customFieldsService.findAll(tenantId);
      testCase.customFields = this.customFieldsService.resolveValues(fields, dto.customFields, testCase.customFields || {}, true);
    }

    // Only re-resolve the chain if this request actually touches one of
    // Project/Module/Phase - untouched fields keep their current value
    // (e.g. changing just Module doesn't require re-passing Project).
    if (dto.projectId !== undefined || dto.moduleId !== undefined || dto.phaseId !== undefined) {
      const { project, module, phase } = await this.resolveProjectModulePhase(
        {
          projectId: dto.projectId !== undefined ? dto.projectId : testCase.projectId ?? undefined,
          moduleId: dto.moduleId !== undefined ? dto.moduleId : testCase.moduleId ?? undefined,
          phaseId: dto.phaseId !== undefined ? dto.phaseId : testCase.phaseId ?? undefined,
        },
        tenantId,
      );
      testCase.projectId = project?.id ?? null;
      testCase.projectName = project?.name ?? null;
      testCase.moduleId = module?.id ?? null;
      testCase.moduleName = module?.name ?? null;
      testCase.phaseId = phase?.id ?? null;
      testCase.phaseName = phase?.name ?? null;
    }
    return this.testCasesRepository.save(testCase);
  }

  // Loads every id in the request (tenant-scoped) or fails the whole
  // request - review actions are all-or-nothing, so a selection that
  // includes a bad row never half-applies.
  private async findManyForReview(ids: number[], tenantId: number): Promise<TestCase[]> {
    const uniqueIds = [...new Set(ids)];
    const testCases = await this.testCasesRepository.find({ where: { id: In(uniqueIds), tenantId } });
    if (testCases.length !== uniqueIds.length) {
      const found = new Set(testCases.map((tc) => tc.id));
      const missing = uniqueIds.filter((id) => !found.has(id));
      throw new NotFoundException(`Test case(s) not found: ${missing.map((id) => `#${id}`).join(', ')}`);
    }
    return testCases;
  }

  private assertReviewStatus(testCases: TestCase[], allowed: TestCaseReviewStatus[], action: string): void {
    const invalid = testCases.filter((tc) => !allowed.includes(tc.reviewStatus));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Only ${allowed.join(' or ')} test cases can be ${action} - ` +
          invalid.map((tc) => `${tc.caseNumber || `#${tc.id}`} is ${tc.reviewStatus}`).join(', '),
      );
    }
  }

  private async recordReviewAudit(
    testCases: TestCase[],
    action: string,
    actor: ReviewActor,
    tenantId: number,
    comment?: string | null,
  ): Promise<void> {
    await Promise.all(
      testCases.map((tc) =>
        this.auditLogService.record({
          userId: actor.id,
          userEmail: actor.email,
          userRole: actor.role,
          action,
          tenantId,
          entityType: 'TestCase',
          entityId: tc.id,
          details: comment ? { comment } : {},
        }),
      ),
    );
  }

  // QA sends Draft/Rejected test cases to the Program Manager. Deprecated
  // cases are refused - there's nothing to execute.
  async submitForReview(ids: number[], actor: ReviewActor, tenantId: number): Promise<TestCase[]> {
    const testCases = await this.findManyForReview(ids, tenantId);
    this.assertReviewStatus(testCases, [TestCaseReviewStatus.DRAFT, TestCaseReviewStatus.REJECTED], 'submitted for review');
    const deprecated = testCases.filter((tc) => tc.status === TestCaseStatus.DEPRECATED);
    if (deprecated.length > 0) {
      throw new BadRequestException(
        `Deprecated test cases cannot be submitted for review: ${deprecated.map((tc) => tc.caseNumber || `#${tc.id}`).join(', ')}`,
      );
    }

    const now = new Date();
    for (const tc of testCases) {
      tc.reviewStatus = TestCaseReviewStatus.PENDING_REVIEW;
      tc.submittedForReviewByUserId = actor.id;
      tc.submittedForReviewByEmail = actor.email;
      tc.submittedForReviewAt = now;
    }
    const saved = await this.testCasesRepository.save(testCases);

    await this.recordReviewAudit(saved, AuditActions.TEST_CASE_SUBMITTED_FOR_REVIEW, actor, tenantId);
    this.eventEmitter.emit('testCases.submittedForReview', { testCases: saved, submittedByEmail: actor.email, tenantId });
    return saved;
  }

  // Program Manager only (role gate in the controller). Approve ->
  // Ready for Execution, comment optional; Reject -> Rejected, comment
  // required so QA knows what to fix.
  async decideReview(
    ids: number[],
    decision: 'approve' | 'reject',
    comment: string | undefined,
    actor: ReviewActor,
    tenantId: number,
  ): Promise<TestCase[]> {
    const trimmedComment = comment?.trim() || null;
    if (decision === 'reject' && !trimmedComment) {
      throw new BadRequestException('A comment is required to reject a test case.');
    }
    const testCases = await this.findManyForReview(ids, tenantId);
    this.assertReviewStatus(testCases, [TestCaseReviewStatus.PENDING_REVIEW], decision === 'approve' ? 'approved' : 'rejected');

    const now = new Date();
    for (const tc of testCases) {
      tc.reviewStatus = decision === 'approve' ? TestCaseReviewStatus.READY_FOR_EXECUTION : TestCaseReviewStatus.REJECTED;
      tc.reviewComment = trimmedComment;
      tc.reviewedByEmail = actor.email;
      tc.reviewedAt = now;
    }
    const saved = await this.testCasesRepository.save(testCases);

    await this.recordReviewAudit(
      saved,
      decision === 'approve' ? AuditActions.TEST_CASE_APPROVED : AuditActions.TEST_CASE_REJECTED,
      actor,
      tenantId,
      trimmedComment,
    );
    this.eventEmitter.emit('testCases.reviewed', { testCases: saved, decision, comment: trimmedComment, reviewedByEmail: actor.email });
    return saved;
  }

  findExecutions(testCaseId: number, tenantId: number): Promise<TestExecution[]> {
    return this.executionsRepository.find({ where: { testCaseId, tenantId }, order: { executedAt: 'DESC' } });
  }

  async recordExecution(
    testCaseId: number,
    dto: CreateTestExecutionDto,
    userId: number,
    userEmail: string,
    tenantId: number,
  ): Promise<TestExecution> {
    const testCase = await this.findOne(testCaseId, tenantId);
    if (testCase.reviewStatus !== TestCaseReviewStatus.READY_FOR_EXECUTION) {
      throw new BadRequestException(
        `A run can only be recorded on a test case that is Ready for Execution - this one is ${testCase.reviewStatus}.`,
      );
    }

    const execution = this.executionsRepository.create({
      testCaseId: testCase.id,
      testCaseTitle: testCase.title,
      projectId: testCase.projectId,
      projectName: testCase.projectName,
      result: dto.result,
      notes: dto.notes,
      defectIssueId: dto.defectIssueId,
      executedByUserId: userId,
      executedByEmail: userEmail,
      tenantId,
    });
    const saved = await this.executionsRepository.save(execution);

    testCase.lastResult = saved.result;
    testCase.lastExecutedAt = saved.executedAt;
    testCase.lastExecutedByEmail = userEmail;
    await this.testCasesRepository.save(testCase);

    return saved;
  }


  // Bulk import from a .csv or .xlsx. Designed so importing a team's
  // existing spreadsheet can't create a mess:
  //   - Headers are matched loosely (test-case-columns.ts), and any
  //     column whose header matches an active custom field's name is
  //     imported into that field. Unmatched columns are reported as
  //     warnings, never silently dropped.
  //   - Every row is validated independently and a bad row is reported
  //     with every problem it has, rather than aborting the batch.
  //   - Rows that already exist are skipped, not duplicated: a caseNumber
  //     matching an existing case (re-importing our own export), or the
  //     same title in the same project as an existing case or an earlier
  //     row in the same file.
  //   - dryRun validates and reports without saving (the Preview step).
  //     The real import re-validates the file from scratch and saves every
  //     valid row in one transaction, so it's all-or-nothing at the DB
  //     level - an unexpected failure never leaves half a file imported.
  async bulkImport(
    dto: BulkImportTestCasesDto,
    actor: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<BulkImportResult> {
    const dryRun = dto.dryRun === true;
    const result: BulkImportResult = { dryRun, totalRows: 0, toImport: [], created: [], skipped: [], errors: [], warnings: [] };
    const fileError = (message: string) => {
      result.errors.push({ row: 0, message });
      return result;
    };

    const sheet = await parseSpreadsheet(dto.fileBase64, dto.format);
    result.totalRows = sheet.rows.length;
    if (sheet.rows.length === 0) {
      return fileError('No data rows found - the first row must be the column headers, with one test case per row below it.');
    }

    const [allProjects, allModules, allPhases, allLabels, allFields, existingCases] = await Promise.all([
      this.projectsService.findAll(tenantId),
      this.modulesService.findAllWithCompletion(tenantId),
      this.phasesService.findAllWithCompletion(tenantId),
      this.labelsService.findAll(tenantId),
      this.customFieldsService.findAll(tenantId),
      this.testCasesRepository.find({ where: { tenantId }, select: ['id', 'caseNumber', 'title', 'projectId'] }),
    ]);

    // Map each spreadsheet column to a built-in column or custom field.
    const builtInIndex = new Map<BuiltInColumn, number>();
    const customFieldIndex = new Map<TestCaseCustomField, number>();
    const fieldByHeader = new Map(allFields.map((f) => [normalizeHeader(f.name), f]));
    sheet.headers.forEach((header, index) => {
      if (!normalizeHeader(header)) {
        if (sheet.rows.some((r) => r.cells[index] !== '')) {
          result.warnings.push(`Column ${index + 1} has no header, so its values were ignored.`);
        }
        return;
      }
      const builtIn = builtInColumnFor(header);
      if (builtIn) {
        if (builtInIndex.has(builtIn)) {
          fileError(`Columns "${sheet.headers[builtInIndex.get(builtIn)!]}" and "${header}" both map to "${builtIn}" - keep only one.`);
        } else {
          builtInIndex.set(builtIn, index);
        }
        return;
      }
      if (isExportOnlyHeader(header)) {
        result.warnings.push(`Column "${header}" is ignored - status and review status are set by the portal, not by import.`);
        return;
      }
      const field = fieldByHeader.get(normalizeHeader(header));
      if (field && field.isActive) {
        if (customFieldIndex.has(field)) {
          fileError(`More than one column maps to custom field "${field.name}" - keep only one.`);
        } else {
          customFieldIndex.set(field, index);
        }
        return;
      }
      result.warnings.push(
        field
          ? `Column "${header}" is ignored - custom field "${field.name}" is inactive.`
          : `Column "${header}" doesn't match any test case field and was ignored. To import it, ask an Admin or Program Manager to add a custom field named "${header}" under Test Case Fields.`,
      );
    });
    const missingColumns = REQUIRED_COLUMNS.filter((col) => !builtInIndex.has(col));
    if (missingColumns.length > 0) {
      fileError(`Missing required column(s): ${missingColumns.join(', ')}.`);
    }
    const unmappedRequiredFields = allFields.filter((f) => f.isActive && f.isRequired && !customFieldIndex.has(f));
    if (unmappedRequiredFields.length > 0) {
      fileError(`Missing column(s) for required custom field(s): ${unmappedRequiredFields.map((f) => f.name).join(', ')}.`);
    }
    if (result.errors.length > 0) return result;

    // Same "one lookup pass, then a map" shape as IssuesBulkService.
    // validateRows() - modules/phases are fetched tenant-wide since a
    // batch can span multiple projects.
    const projectByName = new Map(allProjects.map((p) => [p.name.trim().toLowerCase(), p]));
    const moduleByProjectAndName = new Map(
      allModules.filter((m) => m.isActive).map((m) => [`${m.projectId}::${m.name.trim().toLowerCase()}`, m]),
    );
    const phaseByModuleAndName = new Map(
      allPhases.filter((p) => p.isActive).map((p) => [`${p.moduleId}::${p.name.trim().toLowerCase()}`, p]),
    );
    const labelByName = new Map(allLabels.map((l) => [l.name.trim().toLowerCase(), l]));
    const existingByCaseNumber = new Map(existingCases.filter((tc) => tc.caseNumber).map((tc) => [tc.caseNumber.toLowerCase(), tc]));
    const existingByKey = new Map(existingCases.map((tc) => [duplicateKey(tc.projectId, tc.title), tc]));
    const fileRowByKey = new Map<string, number>();

    const entities: TestCase[] = [];
    for (const { rowNumber, cells } of sheet.rows) {
      const get = (col: BuiltInColumn) => (builtInIndex.has(col) ? cells[builtInIndex.get(col)!] : '');
      const title = get('title');
      const problems: string[] = [];

      const missingFields = REQUIRED_COLUMNS.filter((col) => !get(col));
      if (missingFields.length > 0) problems.push(`Missing ${missingFields.join(', ')}`);

      const matchEnum = <T extends string>(col: BuiltInColumn, values: T[]): T | undefined => {
        const raw = get(col);
        if (!raw) return undefined;
        const match = values.find((v) => v.toLowerCase() === raw.toLowerCase());
        if (!match) problems.push(`Invalid ${col} "${raw}" - must be one of: ${values.join(', ')}`);
        return match;
      };
      const priority = matchEnum('priority', Object.values(Priority));
      const category = matchEnum('category', Object.values(IssueCategory));

      let project: { id: number; name: string } | undefined;
      let module: { id: number; name: string } | undefined;
      let phase: { id: number; name: string } | undefined;
      const projectName = get('projectName');
      const moduleName = get('moduleName');
      const phaseName = get('phaseName');
      if (projectName) {
        project = projectByName.get(projectName.toLowerCase());
        if (!project) problems.push(`Unknown project "${projectName}"`);
      }
      if (moduleName) {
        if (!projectName) {
          problems.push(`Module "${moduleName}" needs a project on the same row`);
        } else if (project) {
          module = moduleByProjectAndName.get(`${project.id}::${moduleName.toLowerCase()}`);
          if (!module) problems.push(`Unknown module "${moduleName}" in project "${project.name}"`);
        }
      }
      if (phaseName) {
        if (!moduleName) {
          problems.push(`Phase "${phaseName}" needs a module on the same row`);
        } else if (module) {
          phase = phaseByModuleAndName.get(`${module.id}::${phaseName.toLowerCase()}`);
          if (!phase) problems.push(`Unknown phase "${phaseName}" in module "${module.name}"`);
        }
      }

      const labelNames = [...new Set(get('labels').split(/[,;]/).map((l) => l.trim()).filter(Boolean))];
      const labels = labelNames.map((name) => labelByName.get(name.toLowerCase()));
      const unknownLabels = labelNames.filter((_, i) => !labels[i]);
      const inactiveLabels = labels.filter((l) => l && !l.isActive).map((l) => l!.name);
      if (unknownLabels.length > 0) {
        problems.push(`Unknown label(s): ${unknownLabels.join(', ')} - add them under Labels first`);
      }
      if (inactiveLabels.length > 0) problems.push(`Inactive label(s): ${inactiveLabels.join(', ')}`);

      const customFields: CustomFieldValues = {};
      for (const [field, index] of customFieldIndex) {
        const raw = cells[index];
        if (!raw) {
          if (field.isRequired) problems.push(`Missing required field "${field.name}"`);
          continue;
        }
        const coerced = this.customFieldsService.coerceValue(field, raw);
        if (coerced.ok) customFields[String(field.id)] = coerced.value;
        else problems.push(coerced.message);
      }

      if (problems.length > 0) {
        result.errors.push({ row: rowNumber, title: title || undefined, message: problems.join('; ') });
        continue;
      }

      const caseNumber = get('caseNumber');
      const existingByNumber = caseNumber ? existingByCaseNumber.get(caseNumber.toLowerCase()) : undefined;
      const key = duplicateKey(project?.id, title);
      const existingSame = existingByNumber || existingByKey.get(key);
      if (existingSame) {
        result.skipped.push({
          row: rowNumber,
          title,
          message: `Already exists as ${existingSame.caseNumber || `#${existingSame.id}`}${existingByNumber ? '' : ' (same title and project)'}`,
        });
        continue;
      }
      if (fileRowByKey.has(key)) {
        result.skipped.push({ row: rowNumber, title, message: `Same title and project as row ${fileRowByKey.get(key)} in this file` });
        continue;
      }
      fileRowByKey.set(key, rowNumber);

      entities.push(
        this.testCasesRepository.create({
          title,
          description: get('description') || undefined,
          preconditions: get('preconditions') || undefined,
          steps: get('steps'),
          expectedResult: get('expectedResult'),
          priority,
          category,
          projectId: project?.id,
          projectName: project?.name,
          moduleId: module?.id,
          moduleName: module?.name,
          phaseId: phase?.id,
          phaseName: phase?.name,
          customFields,
          labelIds: labels.map((l) => l!.id),
          createdByUserId: actor.id,
          createdByEmail: actor.email,
          tenantId,
        }),
      );
      result.toImport.push({
        row: rowNumber,
        title,
        projectName: project?.name ?? null,
        moduleName: module?.name ?? null,
        phaseName: phase?.name ?? null,
        priority: priority ?? null,
        labels: labels.map((l) => l!.name),
        customFieldCount: Object.keys(customFields).length,
      });
    }

    if (dryRun || entities.length === 0) return result;

    const saved = await this.testCasesRepository.manager.transaction(async (em) => {
      const rows = await em.save(TestCase, entities, { chunk: 200 });
      // Same "TC-" + id padded to 4 digits as assignCaseNumber(), in one
      // UPDATE instead of a save per row. lpad() would truncate ids longer
      // than 4 digits, hence the CASE.
      await em
        .createQueryBuilder()
        .update(TestCase)
        .set({ caseNumber: () => `'TC-' || CASE WHEN length(id::text) >= 4 THEN id::text ELSE lpad(id::text, 4, '0') END` })
        .where('id IN (:...ids)', { ids: rows.map((r) => r.id) })
        .execute();
      return rows;
    });
    result.created = saved.map((tc) => ({ id: tc.id, caseNumber: `TC-${String(tc.id).padStart(4, '0')}`, title: tc.title }));

    await this.auditLogService.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: AuditActions.TEST_CASES_BULK_IMPORTED,
      tenantId,
      entityType: 'TestCase',
      details: {
        format: dto.format,
        totalRows: result.totalRows,
        created: result.created.length,
        skipped: result.skipped.length,
        errors: result.errors.length,
        caseNumbers: result.created.map((c) => c.caseNumber),
      },
    });
    return result;
  }

  // Column headers for template/export: built-ins, then every active
  // custom field by name - exactly what bulkImport() reads, so an export
  // re-imports cleanly (its caseNumber column makes those rows skip as
  // "already exists").
  private columnsFor(fields: TestCaseCustomField[]): string[] {
    return [...BUILT_IN_COLUMNS, ...fields.filter((f) => f.isActive).map((f) => f.name)];
  }

  private dropdownsFor(fields: TestCaseCustomField[]): Record<string, string[]> {
    const dropdowns: Record<string, string[]> = {
      priority: Object.values(Priority),
      category: Object.values(IssueCategory),
    };
    for (const f of fields) {
      if (f.isActive && f.fieldType === CustomFieldType.DROPDOWN) dropdowns[f.name] = f.options;
    }
    return dropdowns;
  }

  // Server-generated, not a hardcoded client-side file, so the template
  // always matches the tenant's current custom fields and whatever
  // bulkImport() reads. The .xlsx version adds in-cell dropdowns and an
  // Instructions sheet listing every column's rules and the valid
  // project/module/phase and label names, so a file filled in from it
  // imports without surprises.
  async buildTemplate(tenantId: number, format: TestCaseSpreadsheetFormat): Promise<Buffer> {
    const [fields, labels, projects, modules, phases] = await Promise.all([
      this.customFieldsService.findAll(tenantId),
      this.labelsService.findAll(tenantId),
      this.projectsService.findAll(tenantId),
      this.modulesService.findAllWithCompletion(tenantId),
      this.phasesService.findAllWithCompletion(tenantId),
    ]);
    const activeFields = fields.filter((f) => f.isActive);
    const activeLabels = labels.filter((l) => l.isActive);

    const example: Record<string, string | number> = {
      title: 'Login with valid credentials',
      description: 'Verify a user can log in',
      preconditions: 'User has an active account',
      steps: '1. Go to login\n2. Enter valid email/password\n3. Submit',
      expectedResult: 'User is redirected to the dashboard',
      priority: 'High',
      category: 'New Feature',
      projectName: '',
      moduleName: '',
      phaseName: '',
      labels: activeLabels.slice(0, 2).map((l) => l.name).join(', '),
    };
    // Required fields get a sample value so the example row itself
    // passes validation; optional ones stay blank.
    const sampleValue: Record<CustomFieldType, string | number> = {
      [CustomFieldType.TEXT]: 'Example',
      [CustomFieldType.NUMBER]: 1,
      [CustomFieldType.DATE]: new Date().toISOString().slice(0, 10),
      [CustomFieldType.DROPDOWN]: '',
    };
    for (const f of activeFields) {
      example[f.name] = f.fieldType === CustomFieldType.DROPDOWN ? f.options[0] : f.isRequired ? sampleValue[f.fieldType] : '';
    }

    const describeField = (f: TestCaseCustomField): string => {
      switch (f.fieldType) {
        case CustomFieldType.DROPDOWN:
          return `One of: ${f.options.join(', ')}`;
        case CustomFieldType.DATE:
          return 'Date, YYYY-MM-DD (or an Excel date cell)';
        case CustomFieldType.NUMBER:
          return 'Number';
        default:
          return 'Free text';
      }
    };
    const instructions: string[][] = [
      ['title', 'Yes', 'Free text. A row with the same title in the same project as an existing test case is skipped, not duplicated.'],
      ['description', 'No', 'Free text'],
      ['preconditions', 'No', 'Free text'],
      ['steps', 'Yes', 'Free text - line breaks inside the cell are kept'],
      ['expectedResult', 'Yes', 'Free text'],
      ['priority', 'No', `One of: ${Object.values(Priority).join(', ')}`],
      ['category', 'No', `One of: ${Object.values(IssueCategory).join(', ')}`],
      ['projectName', 'No', 'Exact project name - see the Projects sheet'],
      ['moduleName', 'No', 'Needs projectName on the same row - see the Projects sheet'],
      ['phaseName', 'No', 'Needs moduleName on the same row - see the Projects sheet'],
      ['labels', 'No', `Comma-separated. Existing labels: ${activeLabels.map((l) => l.name).join(', ') || '(none yet)'}`],
      ...activeFields.map((f) => [f.name, f.isRequired ? 'Yes' : 'No', `Custom field - ${describeField(f)}`]),
    ];
    const moduleNamesByProject = new Map<number, typeof modules>();
    modules.filter((m) => m.isActive).forEach((m) => moduleNamesByProject.set(m.projectId, [...(moduleNamesByProject.get(m.projectId) || []), m]));
    const projectRows: string[][] = [];
    for (const p of projects) {
      const projectModules = moduleNamesByProject.get(p.id) || [];
      if (projectModules.length === 0) projectRows.push([p.name, '', '']);
      for (const m of projectModules) {
        const modulePhases = phases.filter((ph) => ph.isActive && ph.moduleId === m.id);
        if (modulePhases.length === 0) projectRows.push([p.name, m.name, '']);
        modulePhases.forEach((ph) => projectRows.push([p.name, m.name, ph.name]));
      }
    }

    const spec: SpreadsheetSpec = {
      columns: this.columnsFor(fields),
      rows: [example],
      dropdowns: this.dropdownsFor(fields),
      referenceSheets: [
        { name: 'Instructions', columns: ['Column', 'Required', 'Allowed values'], rows: instructions },
        { name: 'Projects', columns: ['projectName', 'moduleName', 'phaseName'], rows: projectRows },
      ],
    };
    return writeSpreadsheet(spec, format);
  }

  // Exports the same rows findAll() would return for these filters -
  // there is deliberately no bulk-export equivalent for run history
  // (TestExecution), only the test case catalog itself, mirroring what
  // Issues' bulk-export exports (Issues, not their comments/audit trail).
  async bulkExport(tenantId: number, projectId: number | undefined, format: TestCaseSpreadsheetFormat): Promise<Buffer> {
    const [testCases, fields, labels] = await Promise.all([
      this.findAll(tenantId, projectId),
      this.customFieldsService.findAll(tenantId),
      this.labelsService.findAll(tenantId),
    ]);
    const labelNameById = new Map(labels.map((l) => [l.id, l.name]));
    const activeFields = fields.filter((f) => f.isActive);
    const rows = testCases.map((tc) => {
      const row: Record<string, string | number> = {
        caseNumber: tc.caseNumber || '',
        title: tc.title,
        description: tc.description || '',
        preconditions: tc.preconditions || '',
        steps: tc.steps,
        expectedResult: tc.expectedResult,
        priority: tc.priority || '',
        category: tc.category || '',
        projectName: tc.projectName || '',
        moduleName: tc.moduleName || '',
        phaseName: tc.phaseName || '',
        labels: (tc.labelIds || []).map((id) => labelNameById.get(id)).filter(Boolean).join(', '),
        status: tc.status,
        reviewStatus: tc.reviewStatus,
      };
      for (const f of activeFields) row[f.name] = tc.customFields?.[String(f.id)] ?? '';
      return row;
    });
    return writeSpreadsheet(
      {
        columns: ['caseNumber', ...this.columnsFor(fields), 'status', 'reviewStatus'],
        rows,
        dropdowns: this.dropdownsFor(fields),
      },
      format,
    );
  }
}
