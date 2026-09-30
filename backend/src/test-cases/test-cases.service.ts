import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
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

export interface BulkImportError {
  row: number;
  message: string;
}

const REQUIRED_CSV_COLUMNS = ['title', 'steps', 'expectedResult'];
const CSV_COLUMNS = [
  'title',
  'description',
  'preconditions',
  'steps',
  'expectedResult',
  'priority',
  'category',
  'projectName',
  'moduleName',
  'phaseName',
];

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
  ) {}

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

  // Parses the uploaded CSV and creates one test case per valid row.
  // Nothing fails silently: every row is validated independently and a
  // bad row is skipped with a specific reason rather than aborting the
  // whole batch or being dropped without explanation - same "report what
  // succeeded/what didn't" shape Sprint.addIssues already uses for
  // issues that can't be added.
  async bulkImport(
    csvText: string,
    userId: number,
    userEmail: string,
    tenantId: number,
  ): Promise<{ created: TestCase[]; errors: BulkImportError[] }> {
    let records: Record<string, string>[];
    try {
      records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
    } catch (err: any) {
      return { created: [], errors: [{ row: 0, message: `Could not parse CSV: ${err.message}` }] };
    }

    if (records.length === 0) {
      return { created: [], errors: [{ row: 0, message: 'No rows found in the uploaded CSV' }] };
    }

    const header = Object.keys(records[0]);
    const missingColumns = REQUIRED_CSV_COLUMNS.filter((col) => !header.includes(col));
    if (missingColumns.length > 0) {
      return {
        created: [],
        errors: [{ row: 0, message: `CSV is missing required column(s): ${missingColumns.join(', ')}` }],
      };
    }

    // Cache project/module/phase name -> row lookups across rows instead
    // of hitting the DB once per row. Modules/phases are fetched
    // tenant-wide (not per-project) since a batch can span multiple
    // projects - same "one lookup pass, then a map" shape as
    // IssuesBulkService.validateRows().
    const [allProjects, allModules, allPhases] = await Promise.all([
      this.projectsService.findAll(tenantId),
      this.modulesService.findAllWithCompletion(tenantId),
      this.phasesService.findAllWithCompletion(tenantId),
    ]);
    const projectByName = new Map(allProjects.map((p) => [p.name.toLowerCase(), p]));
    const moduleByProjectAndName = new Map(
      allModules.filter((m) => m.isActive).map((m) => [`${m.projectId}::${m.name.toLowerCase()}`, m]),
    );
    const phaseByModuleAndName = new Map(
      allPhases.filter((p) => p.isActive).map((p) => [`${p.moduleId}::${p.name.toLowerCase()}`, p]),
    );

    const created: TestCase[] = [];
    const errors: BulkImportError[] = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 2; // +1 for 0-index, +1 for the header row itself

      const missingFields = REQUIRED_CSV_COLUMNS.filter((col) => !row[col]?.trim());
      if (missingFields.length > 0) {
        errors.push({ row: rowNumber, message: `Missing required field(s): ${missingFields.join(', ')}` });
        continue;
      }

      let priority: Priority | undefined;
      if (row.priority?.trim()) {
        if (!Object.values(Priority).includes(row.priority.trim() as Priority)) {
          errors.push({
            row: rowNumber,
            message: `Invalid priority "${row.priority}" - must be one of: ${Object.values(Priority).join(', ')}`,
          });
          continue;
        }
        priority = row.priority.trim() as Priority;
      }

      let category: IssueCategory | undefined;
      if (row.category?.trim()) {
        if (!Object.values(IssueCategory).includes(row.category.trim() as IssueCategory)) {
          errors.push({
            row: rowNumber,
            message: `Invalid category "${row.category}" - must be one of: ${Object.values(IssueCategory).join(', ')}`,
          });
          continue;
        }
        category = row.category.trim() as IssueCategory;
      }

      let project: { id: number; name: string } | undefined;
      if (row.projectName?.trim()) {
        const match = projectByName.get(row.projectName.trim().toLowerCase());
        if (!match) {
          errors.push({ row: rowNumber, message: `Unknown project "${row.projectName}"` });
          continue;
        }
        project = { id: match.id, name: match.name };
      }

      let module: { id: number; name: string } | undefined;
      if (row.moduleName?.trim()) {
        if (!project) {
          errors.push({ row: rowNumber, message: `Module "${row.moduleName}" requires a projectName on the same row` });
          continue;
        }
        const match = moduleByProjectAndName.get(`${project.id}::${row.moduleName.trim().toLowerCase()}`);
        if (!match) {
          errors.push({ row: rowNumber, message: `Unknown module "${row.moduleName}" for project "${project.name}"` });
          continue;
        }
        module = { id: match.id, name: match.name };
      }

      let phase: { id: number; name: string } | undefined;
      if (row.phaseName?.trim()) {
        if (!module) {
          errors.push({ row: rowNumber, message: `Phase "${row.phaseName}" requires a moduleName on the same row` });
          continue;
        }
        const match = phaseByModuleAndName.get(`${module.id}::${row.phaseName.trim().toLowerCase()}`);
        if (!match) {
          errors.push({ row: rowNumber, message: `Unknown phase "${row.phaseName}" for module "${module.name}"` });
          continue;
        }
        phase = { id: match.id, name: match.name };
      }

      const testCase = this.testCasesRepository.create({
        title: row.title.trim(),
        description: row.description?.trim() || undefined,
        preconditions: row.preconditions?.trim() || undefined,
        steps: row.steps.trim(),
        expectedResult: row.expectedResult.trim(),
        priority,
        category,
        projectId: project?.id,
        projectName: project?.name,
        moduleId: module?.id,
        moduleName: module?.name,
        phaseId: phase?.id,
        phaseName: phase?.name,
        createdByUserId: userId,
        createdByEmail: userEmail,
        tenantId,
      });
      const saved = await this.testCasesRepository.save(testCase);
      created.push(await this.assignCaseNumber(saved));
    }

    return { created, errors };
  }

  // Server-generated template, same shape as
  // IssueSpreadsheetService.buildTemplate() - one header row plus one
  // worked example, so a fresh download always matches whatever columns
  // bulkImport() actually reads (unlike the old hardcoded client-side
  // string, which could silently drift out of sync with this file).
  buildCsvTemplate(): string {
    return stringify(
      [
        {
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
        },
      ],
      { header: true, columns: CSV_COLUMNS },
    );
  }

  // Exports the same rows findAll() would return for these filters -
  // there is deliberately no bulk-export equivalent for run history
  // (TestExecution), only the test case catalog itself, mirroring what
  // Issues' bulk-export exports (Issues, not their comments/audit trail).
  async bulkExport(tenantId: number, projectId?: number): Promise<string> {
    const testCases = await this.findAll(tenantId, projectId);
    return stringify(
      testCases.map((tc) => ({
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
        status: tc.status,
        reviewStatus: tc.reviewStatus,
      })),
      { header: true, columns: ['caseNumber', ...CSV_COLUMNS, 'status', 'reviewStatus'] },
    );
  }
}
