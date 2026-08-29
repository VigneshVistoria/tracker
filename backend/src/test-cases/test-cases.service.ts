import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { TestCase, TestCaseStatus } from './test-case.entity';
import { TestExecution, TestResult } from './test-execution.entity';
import { CreateTestCaseDto } from './dto/create-test-case.dto';
import { UpdateTestCaseDto } from './dto/update-test-case.dto';
import { CreateTestExecutionDto } from './dto/create-test-execution.dto';
import { Priority } from '../common/priority.enum';
import { IssueCategory } from '../issues/issue.entity';
import { ProjectsService } from '../projects/projects.service';

export interface BulkImportError {
  row: number;
  message: string;
}

const REQUIRED_CSV_COLUMNS = ['title', 'steps', 'expectedResult'];

@Injectable()
export class TestCasesService {
  constructor(
    @InjectRepository(TestCase)
    private testCasesRepository: Repository<TestCase>,
    @InjectRepository(TestExecution)
    private executionsRepository: Repository<TestExecution>,
    private projectsService: ProjectsService,
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

  async create(dto: CreateTestCaseDto, userId: number, userEmail: string, tenantId: number): Promise<TestCase> {
    const project = await this.resolveProject(dto.projectId, tenantId);
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
      createdByUserId: userId,
      createdByEmail: userEmail,
      tenantId,
    });
    return this.testCasesRepository.save(testCase);
  }

  async update(id: number, dto: UpdateTestCaseDto, tenantId: number): Promise<TestCase> {
    const testCase = await this.findOne(id, tenantId);
    if (dto.title !== undefined) testCase.title = dto.title;
    if (dto.description !== undefined) testCase.description = dto.description;
    if (dto.preconditions !== undefined) testCase.preconditions = dto.preconditions;
    if (dto.steps !== undefined) testCase.steps = dto.steps;
    if (dto.expectedResult !== undefined) testCase.expectedResult = dto.expectedResult;
    if (dto.priority !== undefined) testCase.priority = dto.priority;
    if (dto.category !== undefined) testCase.category = dto.category;
    if (dto.status !== undefined) testCase.status = dto.status;
    if (dto.projectId !== undefined) {
      const project = await this.resolveProject(dto.projectId, tenantId);
      testCase.projectId = project?.id ?? null;
      testCase.projectName = project?.name ?? null;
    }
    return this.testCasesRepository.save(testCase);
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

    // Cache project name -> id lookups across rows instead of hitting the
    // DB once per row.
    const allProjects = await this.projectsService.findAll(tenantId);
    const projectByName = new Map(allProjects.map((p) => [p.name.toLowerCase(), p]));

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
        createdByUserId: userId,
        createdByEmail: userEmail,
        tenantId,
      });
      created.push(await this.testCasesRepository.save(testCase));
    }

    return { created, errors };
  }
}
