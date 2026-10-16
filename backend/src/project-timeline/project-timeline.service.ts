import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { ProjectTimelineRow } from './project-timeline-row.entity';
import { ProjectTimelineTeam } from './project-timeline-team.entity';
import { ProjectTimelineDependency } from './project-timeline-dependency.entity';
import { wouldCreateCycle } from './project-timeline-dependencies';
import { ProjectTimelineTicketLink } from './project-timeline-ticket-link.entity';
import { percentFor, rowProgress, ticketsByRow } from './project-timeline-tickets';
import { ProjectTask } from '../tasks/project-task.entity';
import { ProjectModule } from '../modules/project-module.entity';
import { Phase } from '../phases/phase.entity';
import { TaskStatusConfigService } from '../task-status-config/task-status-config.service';
import {
  EXPORT_INFO_COLUMNS,
  TIMELINE_COLUMNS,
  TIMELINE_STATUSES,
  TimelineStatus,
  BaselineEvent,
  buildBaselines,
  buildExportRows,
  buildPreview,
  fileDate,
  matchKeyFor,
  nameKey,
  parsePlanDate,
  rowValueErrors,
  rowsFromSheet,
  summarizePlan,
  tidyName,
} from './project-timeline-rules';
import { ApplyTimelineImportDto, CreateTimelineDependencyDto, CreateTimelineTicketLinkDto, ExportTimelineDto, ParseTimelineFileDto, PreviewTimelineImportDto, SaveTimelineChangesDto } from './dto/project-timeline.dto';
import { parseSpreadsheet } from '../test-cases/test-case-spreadsheet';
import { Project } from '../projects/project.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TEAM_SETTINGS_DEFAULTS, dateInZone, isValidTimeZone } from '../team-settings/time-zone';
import { AuditActions, AuditLogService } from '../audit/audit-log.service';
import { User } from '../users/user.entity';

const ENTITY_TYPE = 'ProjectTimelineRow';

type Actor = Pick<User, 'id' | 'email' | 'role'>;
type Field = 'module' | 'phase' | 'team' | 'status' | 'startDate' | 'endDate' | 'order';

// Project Timeline (2026-10-16). Nothing reaches the plan until the PM
// clicks Import on a preview (applyImport) or Save changes (saveChanges);
// parse and preview never write. Every row change writes one audit_logs
// entry (who, when, old and new values) in the same transaction as the
// change, so a change can't exist without its audit row. Changes to one
// project's plan are serialised with a transaction-scoped advisory lock.
@Injectable()
export class ProjectTimelineService {
  constructor(
    @InjectRepository(ProjectTimelineRow) private rowsRepository: Repository<ProjectTimelineRow>,
    @InjectRepository(ProjectTimelineTeam) private teamsRepository: Repository<ProjectTimelineTeam>,
    @InjectRepository(ProjectTimelineDependency) private depsRepository: Repository<ProjectTimelineDependency>,
    @InjectRepository(ProjectTimelineTicketLink) private ticketLinksRepository: Repository<ProjectTimelineTicketLink>,
    @InjectRepository(ProjectTask) private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(ProjectModule) private modulesRepository: Repository<ProjectModule>,
    @InjectRepository(Phase) private phasesRepository: Repository<Phase>,
    private taskStatusConfigService: TaskStatusConfigService,
    @InjectRepository(Project) private projectsRepository: Repository<Project>,
    @InjectRepository(TeamSettings) private teamSettingsRepository: Repository<TeamSettings>,
    private dataSource: DataSource,
    private auditLogService: AuditLogService,
  ) {}

  // ------------------------------------------------------------- reads

  // "Today" in the team's time zone (team_settings, as Daily Scrum).
  async today(tenantId: number): Promise<{ today: string; timeZone: string }> {
    const settings = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    const timeZone = isValidTimeZone(settings?.timeZone) ? settings!.timeZone : TEAM_SETTINGS_DEFAULTS.timeZone;
    return { today: dateInZone(new Date(), timeZone), timeZone };
  }

  async listProjects(tenantId: number) {
    const rows: { id: number; name: string; rowCount: string }[] = await this.projectsRepository
      .createQueryBuilder('p')
      .leftJoin(ProjectTimelineRow, 'r', 'r."projectId" = p.id AND r."tenantId" = p."tenantId"')
      .select(['p.id AS id', 'p.name AS name', 'COUNT(r.id) AS "rowCount"'])
      .where('p."tenantId" = :tenantId', { tenantId })
      .groupBy('p.id')
      .orderBy('p.name', 'ASC')
      .getRawMany();
    return rows.map((r) => ({ id: Number(r.id), name: r.name, rowCount: Number(r.rowCount) }));
  }

  listTeams(tenantId: number) {
    return this.teamsRepository.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async getPlan(projectId: number, tenantId: number) {
    const project = await this.findProject(projectId, tenantId);
    const [rows, teams, { today, timeZone }] = await Promise.all([
      this.rowsRepository.find({ where: { tenantId, projectId }, order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.listTeams(tenantId),
      this.today(tenantId),
    ]);
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    return {
      project: { id: project.id, name: project.name },
      rows: rows.map((r) => ({ ...r, teamName: r.teamId != null ? teamName.get(r.teamId) ?? null : null })),
      teams,
      statuses: TIMELINE_STATUSES,
      today,
      timeZone,
      summary: summarizePlan(rows, today),
    };
  }

  private async findProject(projectId: number, tenantId: number, em?: EntityManager): Promise<Project> {
    const repo = em ? em.getRepository(Project) : this.projectsRepository;
    const project = await repo.findOne({ where: { id: projectId, tenantId } });
    if (!project) throw new NotFoundException('Project not found.');
    return project;
  }

  // ------------------------------------------------------- file + preview

  // Reads the file into raw rows. Saves nothing.
  async parseFile(dto: ParseTimelineFileDto) {
    const sheet = await parseSpreadsheet(dto.fileBase64, dto.format);
    const { rows, missingColumns, ignoredColumns } = rowsFromSheet(sheet);
    if (missingColumns.length) {
      throw new BadRequestException(
        `The file is missing ${missingColumns.length === 1 ? 'this column' : 'these columns'}: ${missingColumns.join(', ')}. ` +
          `Expected columns: ${TIMELINE_COLUMNS.join(', ')} (download the template to see the layout).`,
      );
    }
    if (rows.length === 0) throw new BadRequestException('The file has no data rows under the header.');
    return { rows, ignoredColumns };
  }

  // Validation, name fix suggestions, the re-upload diff and the summary
  // numbers for (possibly PM-edited) rows. Saves nothing.
  async preview(projectId: number, dto: PreviewTimelineImportDto, tenantId: number) {
    await this.findProject(projectId, tenantId);
    const [saved, teams, { today }] = await Promise.all([
      this.rowsRepository.find({ where: { tenantId, projectId }, order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.listTeams(tenantId),
      this.today(tenantId),
    ]);
    return { today, ...buildPreview({ rows: this.rawRows(dto), saved, teams, today }) };
  }

  private rawRows(dto: PreviewTimelineImportDto) {
    return dto.rows.map((r) => ({
      rowNumber: r.rowNumber,
      module: r.module ?? '',
      phase: r.phase ?? '',
      team: r.team ?? '',
      status: r.status ?? '',
      startDate: r.startDate ?? '',
      endDate: r.endDate ?? '',
      include: r.include,
    }));
  }

  private async lockPlan(em: EntityManager, tenantId: number, projectId: number) {
    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`project_timeline:${tenantId}:${projectId}`]);
  }

  // ---------------------------------------------------------------- import

  // Re-validates everything from scratch (never trusts an earlier
  // preview) and applies only ticked, error-free rows that are new or
  // changed. Rows with errors are skipped and reported back with the
  // reason. Saved rows missing from the file are kept unless listed in
  // deleteIds.
  async applyImport(projectId: number, dto: ApplyTimelineImportDto, actor: Actor, tenantId: number) {
    const batchId = randomUUID();
    const result = await this.dataSource.transaction(async (em) => {
      const project = await this.findProject(projectId, tenantId, em);
      await this.lockPlan(em, tenantId, projectId);
      const rowRepo = em.getRepository(ProjectTimelineRow);
      const teamRepo = em.getRepository(ProjectTimelineTeam);
      const saved = await rowRepo.find({ where: { tenantId, projectId }, order: { sortOrder: 'ASC', id: 'ASC' } });
      const teams = await teamRepo.find({ where: { tenantId } });
      const { today } = await this.today(tenantId);
      const preview = buildPreview({ rows: this.rawRows(dto), saved, teams, today });

      const deleteIds = [...new Set(dto.deleteIds || [])];
      const missingIds = new Set(preview.missing.map((m) => m.id));
      const notMissing = deleteIds.filter((id) => !missingIds.has(id));
      if (notMissing.length) {
        throw new BadRequestException('Only rows that are missing from the file can be deleted on import - check the preview again.');
      }

      const base = { tenantId, projectId, projectName: project.name, batchId, source: 'import' };
      const teamIdByKey = new Map(teams.map((t) => [nameKey(t.name), t.id]));
      const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
      const teamsCreated: string[] = [];
      for (const name of preview.summary.newTeams) {
        const team = await teamRepo.save(teamRepo.create({ tenantId, name, isActive: true, createdByUserId: actor.id }));
        teamIdByKey.set(nameKey(name), team.id);
        teamNameById.set(team.id, team.name);
        teamsCreated.push(team.name);
        await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_TEAM_CREATED, 'ProjectTimelineTeam', team.id, { name, batchId, source: 'import' });
      }

      let nextOrder = saved.reduce((max, r) => Math.max(max, r.sortOrder), 0);
      let created = 0;
      let updated = 0;
      for (const r of preview.rows) {
        if (!r.include || r.errors.length || r.diff === 'unchanged' || r.diff == null) continue;
        const teamId = r.values.team ? teamIdByKey.get(nameKey(r.values.team)) ?? null : null;
        const values = {
          module: r.values.module,
          phase: r.values.phase,
          matchKey: matchKeyFor(r.values.module, r.values.phase),
          teamId,
          status: r.values.status,
          startDate: r.values.startDate,
          endDate: r.values.endDate,
          updatedByUserId: actor.id,
          updatedByEmail: actor.email,
        };
        if (r.diff === 'new') {
          nextOrder += 1;
          const row = await rowRepo.save(
            rowRepo.create({ ...values, tenantId, projectId, sortOrder: nextOrder, version: 1, createdByUserId: actor.id, createdByEmail: actor.email }),
          );
          created += 1;
          await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_ROW_CREATED, ENTITY_TYPE, row.id, {
            ...base,
            rowNumber: r.rowNumber,
            values: this.auditValues(row, teamNameById),
          });
        } else {
          const existing = saved.find((s) => s.id === r.existingId)!;
          const before = this.auditValues(existing, teamNameById);
          Object.assign(existing, values, { version: existing.version + 1 });
          await rowRepo.save(existing);
          updated += 1;
          await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_ROW_UPDATED, ENTITY_TYPE, existing.id, {
            ...base,
            rowNumber: r.rowNumber,
            module: existing.module,
            phase: existing.phase,
            changes: this.diffValues(before, this.auditValues(existing, teamNameById)),
          });
        }
      }

      for (const id of deleteIds) {
        const row = saved.find((s) => s.id === id)!;
        await rowRepo.delete({ id, tenantId });
        await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_ROW_DELETED, ENTITY_TYPE, id, {
          ...base,
          snapshot: this.auditValues(row, teamNameById),
        });
      }

      const skipped = preview.rows.filter((r) => r.include && r.errors.length).map((r) => ({ rowNumber: r.rowNumber, errors: r.errors }));
      const counts = {
        created,
        updated,
        unchanged: preview.summary.unchangedRows,
        deleted: deleteIds.length,
        skipped: skipped.length,
        unticked: preview.rows.filter((r) => !r.include).length,
        teamsCreated,
      };
      if (created || updated || deleteIds.length) {
        await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_IMPORTED, 'Project', projectId, {
          ...base,
          totalRows: preview.summary.totalRows,
          ...counts,
          skippedRows: skipped.slice(0, 200),
        });
      }
      return { ...counts, skippedRows: skipped };
    });
    return { ...result, plan: await this.getPlan(projectId, tenantId) };
  }

  // ---------------------------------------------------------- save changes

  // The table's "Save changes": creates, updates (only the fields sent)
  // and deletes in one transaction. Rejected as a whole if any row was
  // changed by someone else since the page loaded it (version mismatch),
  // if any row breaks a rule, or if two rows would end up with the same
  // Module + Phase.
  async saveChanges(projectId: number, dto: SaveTimelineChangesDto, actor: Actor, tenantId: number) {
    const creates = dto.creates || [];
    const updates = dto.updates || [];
    const deletes = dto.deletes || [];
    const batchId = randomUUID();
    await this.dataSource.transaction(async (em) => {
      const project = await this.findProject(projectId, tenantId, em);
      await this.lockPlan(em, tenantId, projectId);
      const rowRepo = em.getRepository(ProjectTimelineRow);
      const saved = await rowRepo.find({ where: { tenantId, projectId } });
      const byId = new Map(saved.map((r) => [r.id, r]));
      const teams = await em.getRepository(ProjectTimelineTeam).find({ where: { tenantId } });
      const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

      const label = (r: { module: string; phase: string }) => `"${r.module} / ${r.phase}"`;
      const problems: string[] = [];
      const conflicts: string[] = [];
      const touched = new Set<number>();
      for (const item of [...deletes, ...updates]) {
        const row = byId.get(item.id);
        if (!row) {
          conflicts.push(`row ${item.id} no longer exists`);
          continue;
        }
        if (touched.has(item.id)) problems.push(`${label(row)} is listed more than once`);
        touched.add(item.id);
        if (row.version !== item.version) conflicts.push(`${label(row)} was changed by someone else`);
      }
      if (conflicts.length) {
        throw new ConflictException(
          `Nothing was saved: ${conflicts.join('; ')} since you loaded this page. Reload to see the latest plan, then make your changes again.`,
        );
      }

      const checkTeam = (teamId: number | null | undefined, what: string) => {
        if (teamId != null && !teamNameById.has(teamId)) problems.push(`${what}: that team doesn't exist`);
      };
      const checkDates = (startDate: string | null, endDate: string | null, what: string) => {
        for (const d of [startDate, endDate]) {
          if (d && parsePlanDate(d).error) problems.push(`${what}: ${d} is not a real date`);
        }
      };

      // Final state of every row this save touches.
      const deleteIds = new Set(deletes.map((d) => d.id));
      const updatedRows = updates.map((u) => {
        const row = byId.get(u.id)!;
        const next = {
          module: u.module !== undefined ? tidyName(u.module) : row.module,
          phase: u.phase !== undefined ? tidyName(u.phase) : row.phase,
          teamId: u.teamId !== undefined ? u.teamId ?? null : row.teamId,
          status: (u.status ?? row.status) as TimelineStatus,
          startDate: u.startDate !== undefined ? u.startDate ?? null : row.startDate,
          endDate: u.endDate !== undefined ? u.endDate ?? null : row.endDate,
          sortOrder: u.sortOrder ?? row.sortOrder,
        };
        const what = label(row);
        rowValueErrors(next).forEach((e) => problems.push(`${what}: ${e}`));
        if (u.teamId !== undefined && u.teamId !== row.teamId) checkTeam(next.teamId, what);
        checkDates(next.startDate, next.endDate, what);
        return { row, next };
      });
      const createdRows = creates.map((c, i) => {
        const next = {
          module: tidyName(c.module),
          phase: tidyName(c.phase),
          teamId: c.teamId ?? null,
          status: c.status,
          startDate: c.startDate ?? null,
          endDate: c.endDate ?? null,
          sortOrder: c.sortOrder ?? 0,
        };
        const what = next.module || next.phase ? label(next) : `New row ${i + 1}`;
        rowValueErrors(next).forEach((e) => problems.push(`${what}: ${e}`));
        checkTeam(next.teamId, what);
        checkDates(next.startDate, next.endDate, what);
        return next;
      });

      // No duplicates in the plan as it will be after this save.
      const finalRows = [
        ...saved.filter((r) => !deleteIds.has(r.id) && !updates.some((u) => u.id === r.id)),
        ...updatedRows.map((u) => u.next),
        ...createdRows,
      ];
      const seen = new Map<string, { module: string; phase: string }>();
      for (const r of finalRows) {
        const key = matchKeyFor(r.module, r.phase);
        if (seen.has(key)) problems.push(`${label(r)} would appear twice - each Module + Phase can only be in the plan once`);
        else seen.set(key, r);
      }
      if (problems.length) throw new BadRequestException(`Nothing was saved: ${[...new Set(problems)].join('; ')}`);

      const base = { tenantId, projectId, projectName: project.name, batchId, source: 'edit' };
      for (const d of deletes) {
        const row = byId.get(d.id)!;
        await rowRepo.delete({ id: d.id, tenantId });
        await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_ROW_DELETED, ENTITY_TYPE, d.id, {
          ...base,
          snapshot: this.auditValues(row, teamNameById),
        });
      }
      for (const { row, next } of updatedRows) {
        const before = this.auditValues(row, teamNameById);
        Object.assign(row, next, { matchKey: matchKeyFor(next.module, next.phase) });
        const changes = this.diffValues(before, this.auditValues(row, teamNameById));
        if (!Object.keys(changes).length) continue;
        Object.assign(row, { version: row.version + 1, updatedByUserId: actor.id, updatedByEmail: actor.email });
        await rowRepo.save(row);
        await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_ROW_UPDATED, ENTITY_TYPE, row.id, {
          ...base,
          module: row.module,
          phase: row.phase,
          changes,
        });
      }
      for (const next of createdRows) {
        const row = await rowRepo.save(
          rowRepo.create({
            ...next,
            tenantId,
            projectId,
            matchKey: matchKeyFor(next.module, next.phase),
            version: 1,
            createdByUserId: actor.id,
            createdByEmail: actor.email,
            updatedByUserId: actor.id,
            updatedByEmail: actor.email,
          }),
        );
        await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_ROW_CREATED, ENTITY_TYPE, row.id, {
          ...base,
          values: this.auditValues(row, teamNameById),
        });
      }
    });
    return this.getPlan(projectId, tenantId);
  }

  // ------------------------------------------------------------ baselines

  // Slip tracking: each current row's baseline (see buildBaselines) and
  // the project's baseline resets, newest first. Read-only.
  async getSlip(projectId: number, tenantId: number) {
    await this.findProject(projectId, tenantId);
    const rows = await this.rowsRepository.find({ where: { tenantId, projectId }, select: ['id'] });
    const ids = rows.map((r) => r.id);
    const [rowEvents, resetEvents] = await Promise.all([
      this.auditLogService.findForEntities(tenantId, ENTITY_TYPE, ids, [AuditActions.PROJECT_TIMELINE_ROW_CREATED, AuditActions.PROJECT_TIMELINE_ROW_UPDATED]),
      this.auditLogService.findForEntities(tenantId, 'Project', [projectId], [AuditActions.PROJECT_TIMELINE_BASELINE_RESET]),
    ]);
    const events: BaselineEvent[] = [
      ...rowEvents.map((e) => ({
        id: e.id,
        action: (e.action === AuditActions.PROJECT_TIMELINE_ROW_CREATED ? 'created' : 'updated') as BaselineEvent['action'],
        rowId: e.entityId,
        at: e.createdAt,
        by: e.userEmail,
        details: e.details,
      })),
      ...resetEvents.map((e) => ({ id: e.id, action: 'reset' as const, rowId: null, at: e.createdAt, by: e.userEmail, details: e.details })),
    ];
    const baselines = buildBaselines(ids, events);
    const resets = resetEvents
      .map((e) => ({ at: e.createdAt, by: e.userEmail, reason: (e.details as any)?.reason ?? null, rows: ((e.details as any)?.snapshot || []).length }))
      .reverse();
    const firstCreated = rowEvents.find((e) => e.action === AuditActions.PROJECT_TIMELINE_ROW_CREATED);
    return {
      // What "planned" means right now: the latest reset, else the first time rows entered the plan.
      baselineFrom: resets[0]?.at ?? firstCreated?.createdAt ?? null,
      resets,
      rows: [...baselines.values()],
    };
  }

  // PM only (controller): the saved dates of every row become the new
  // baseline. One audit entry holds the reason and the snapshot; nothing
  // else changes and older history stays in the audit log.
  async resetBaseline(projectId: number, rawReason: string, actor: Actor, tenantId: number) {
    const reason = String(rawReason ?? '').trim();
    if (!reason) throw new BadRequestException('A reason is required to reset the baseline.');
    await this.dataSource.transaction(async (em) => {
      const project = await this.findProject(projectId, tenantId, em);
      await this.lockPlan(em, tenantId, projectId);
      const rows = await em.getRepository(ProjectTimelineRow).find({ where: { tenantId, projectId }, order: { sortOrder: 'ASC', id: 'ASC' } });
      if (rows.length === 0) throw new BadRequestException('This project has no plan rows to set a baseline for.');
      await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_BASELINE_RESET, 'Project', projectId, {
        tenantId,
        projectId,
        projectName: project.name,
        reason,
        snapshot: rows.map((r) => ({ id: r.id, startDate: r.startDate ?? null, endDate: r.endDate ?? null })),
      });
    });
    return this.getSlip(projectId, tenantId);
  }

  // ----------------------------------------------------------------- teams

  async createTeam(rawName: string, actor: Actor, tenantId: number) {
    const name = tidyName(rawName);
    if (!name) throw new BadRequestException('Team name is required.');
    const existing = (await this.listTeams(tenantId)).find((t) => nameKey(t.name) === nameKey(name));
    if (existing) throw new ConflictException(`A team called "${existing.name}" already exists.`);
    return this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(ProjectTimelineTeam);
      const team = await repo.save(repo.create({ tenantId, name, isActive: true, createdByUserId: actor.id }));
      await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_TEAM_CREATED, 'ProjectTimelineTeam', team.id, { name, source: 'edit' });
      return team;
    });
  }

  // -------------------------------------------------------------- template

  async template(format: 'csv' | 'xlsx'): Promise<{ buffer: Buffer; filename: string }> {
    const columns = [...TIMELINE_COLUMNS];
    const examples = [
      ['Medical Claim', 'Requirements Gathering', 'Vistoria', 'Completed', '1-Jul-26', '10-Jul-26'],
      ['Medical Claim', 'User Acceptance Testing', 'Amanah', 'To Do', '13-Jul-26', '24-Jul-26'],
    ];
    if (format === 'csv') {
      return { buffer: Buffer.from(stringify([columns, ...examples]), 'utf-8'), filename: 'project-timeline-template.csv' };
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Project Timeline', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map((header) => ({ header, key: header, width: header === 'Phase' ? 36 : 18 }));
    sheet.getRow(1).font = { bold: true };
    examples.forEach((r) => sheet.addRow(r));
    const statusCol = columns.indexOf('Status') + 1;
    for (let r = 2; r <= 1001; r++) {
      sheet.getCell(r, statusCol).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${TIMELINE_STATUSES.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Not an allowed status',
        error: `Pick one of: ${TIMELINE_STATUSES.join(', ')}`,
      };
    }
    const help = workbook.addWorksheet('Instructions');
    help.columns = [{ header: 'How to fill in this file', key: 'text', width: 100 }];
    help.getRow(1).font = { bold: true };
    [
      'One row per Module + Phase. Module and Phase are required.',
      `Status: one of ${TIMELINE_STATUSES.join(', ')}. Empty = To Do.`,
      'Dates: like 1-Jul-26 (2-digit years mean 20xx), or real Excel dates. Empty is allowed.',
      'End Date can not be before Start Date.',
      'Team: a name from the Team list (e.g. Amanah, Vistoria). A new name is added to the list on import.',
      'Uploading again updates the rows with the same Module + Phase - it never creates duplicates.',
    ].forEach((text) => help.addRow({ text }));
    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: 'project-timeline-template.xlsx' };
  }

  // ---------------------------------------------------------------- export

  // The saved rows asked for (all when rowIds is missing), in plan order,
  // as a file that can be imported again. Read-only.
  async exportPlan(projectId: number, dto: ExportTimelineDto, tenantId: number): Promise<{ buffer: Buffer; filename: string }> {
    const project = await this.findProject(projectId, tenantId);
    const [allRows, teams, { today }, slip] = await Promise.all([
      this.rowsRepository.find({ where: { tenantId, projectId }, order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.listTeams(tenantId),
      this.today(tenantId),
      this.getSlip(projectId, tenantId),
    ]);
    let rows = allRows;
    if (dto.rowIds) {
      const wanted = new Set(dto.rowIds);
      rows = allRows.filter((r) => wanted.has(r.id));
      if (rows.length !== wanted.size) {
        throw new BadRequestException('Some of these rows are no longer in the plan. Reload the page and export again.');
      }
    }
    const data = buildExportRows({
      rows,
      allRows,
      teamNameById: new Map(teams.map((t) => [t.id, t.name])),
      today,
      baselineEndById: new Map(slip.rows.map((b) => [b.rowId, b.baselineEnd])),
    });
    const columns = [...TIMELINE_COLUMNS, ...EXPORT_INFO_COLUMNS];
    const safeName = project.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
    const filename = `${safeName}-timeline-${today}.${dto.format}`;
    const info = (r: (typeof data)[number]) => [r.overdue ? 'Yes' : '', r.overlapsWith.join('; '), r.slip ?? ''];

    if (dto.format === 'csv') {
      const lines = data.map((r) => [r.module, r.phase, r.team, r.status, fileDate(r.startDate), fileDate(r.endDate), ...info(r)]);
      // BOM so Excel opens the UTF-8 file with the right characters.
      return { buffer: Buffer.from('\uFEFF' + stringify([columns, ...lines]), 'utf-8'), filename };
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Project Timeline', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map((header) => ({ header, key: header, width: header === 'Phase' || header === 'Overlaps with' ? 36 : 18 }));
    sheet.getRow(1).font = { bold: true };
    const asDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
    data.forEach((r) => sheet.addRow([r.module, r.phase, r.team, r.status, asDate(r.startDate), asDate(r.endDate), ...info(r)]));
    for (const header of ['Start Date', 'End Date']) sheet.getColumn(header).numFmt = 'd-mmm-yy';
    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename };
  }

  // ----------------------------------------------------------------- audit

  private auditValues(row: Pick<ProjectTimelineRow, 'module' | 'phase' | 'teamId' | 'status' | 'startDate' | 'endDate' | 'sortOrder'>, teamNameById: Map<number, string>) {
    return {
      module: row.module,
      phase: row.phase,
      team: row.teamId != null ? teamNameById.get(row.teamId) ?? `#${row.teamId}` : null,
      status: row.status,
      startDate: row.startDate ?? null,
      endDate: row.endDate ?? null,
      order: row.sortOrder,
    } as Record<Field, string | number | null>;
  }

  // ---------------------------------------------------- dependencies (B)

  async listDependencies(projectId: number, tenantId: number, em?: EntityManager) {
    await this.findProject(projectId, tenantId, em);
    const repo = em ? em.getRepository(ProjectTimelineDependency) : this.depsRepository;
    const deps = await repo.find({ where: { tenantId, projectId }, order: { id: 'ASC' } });
    return deps.map((d) => ({ id: d.id, predecessorRowId: d.predecessorRowId, successorRowId: d.successorRowId, lagDays: d.lagDays, createdAt: d.createdAt }));
  }

  // Both rows must be in this project's plan; no duplicates, no loops.
  // Serialised with the plan lock, so two adds can't race into a loop.
  async addDependency(projectId: number, dto: CreateTimelineDependencyDto, actor: Actor, tenantId: number) {
    return this.dataSource.transaction(async (em) => {
      await this.findProject(projectId, tenantId, em);
      await this.lockPlan(em, tenantId, projectId);
      const [pred, succ] = await Promise.all([dto.predecessorRowId, dto.successorRowId].map((id) => this.findPlanRow(em, id, projectId, tenantId)));
      if (pred.id === succ.id) throw new BadRequestException('A phase can\'t depend on itself.');
      const repo = em.getRepository(ProjectTimelineDependency);
      const existing = await repo.find({ where: { tenantId, projectId } });
      if (existing.some((d) => d.predecessorRowId === pred.id && d.successorRowId === succ.id)) {
        throw new ConflictException(`“${succ.phase}” already starts after “${pred.phase}”.`);
      }
      if (wouldCreateCycle(existing, pred.id, succ.id)) {
        throw new BadRequestException(`That would make a loop: “${pred.phase}” already depends (directly or through other phases) on “${succ.phase}”.`);
      }
      const lagDays = dto.lagDays ?? 0;
      const saved = await repo.save(repo.create({ tenantId, projectId, predecessorRowId: pred.id, successorRowId: succ.id, lagDays, createdByUserId: actor.id }));
      await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_DEPENDENCY_ADDED, 'ProjectTimelineDependency', saved.id, {
        projectId,
        predecessor: { id: pred.id, module: pred.module, phase: pred.phase },
        successor: { id: succ.id, module: succ.module, phase: succ.phase },
        lagDays,
      });
      return this.listDependencies(projectId, tenantId, em);
    });
  }

  async updateDependency(projectId: number, depId: number, lagDays: number, actor: Actor, tenantId: number) {
    return this.dataSource.transaction(async (em) => {
      await this.findProject(projectId, tenantId, em);
      await this.lockPlan(em, tenantId, projectId);
      const repo = em.getRepository(ProjectTimelineDependency);
      const dep = await repo.findOne({ where: { id: depId, tenantId, projectId } });
      if (!dep) throw new NotFoundException('Dependency not found.');
      if (dep.lagDays !== lagDays) {
        const old = dep.lagDays;
        dep.lagDays = lagDays;
        await repo.save(dep);
        await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_DEPENDENCY_UPDATED, 'ProjectTimelineDependency', dep.id, {
          projectId,
          ...(await this.depNames(em, dep, projectId, tenantId)),
          lagDays: { old, new: lagDays },
        });
      }
      return this.listDependencies(projectId, tenantId, em);
    });
  }

  async removeDependency(projectId: number, depId: number, actor: Actor, tenantId: number) {
    return this.dataSource.transaction(async (em) => {
      await this.findProject(projectId, tenantId, em);
      await this.lockPlan(em, tenantId, projectId);
      const repo = em.getRepository(ProjectTimelineDependency);
      const dep = await repo.findOne({ where: { id: depId, tenantId, projectId } });
      if (!dep) throw new NotFoundException('Dependency not found.');
      const names = await this.depNames(em, dep, projectId, tenantId);
      await repo.delete({ id: dep.id });
      await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_DEPENDENCY_REMOVED, 'ProjectTimelineDependency', dep.id, {
        projectId,
        ...names,
        lagDays: dep.lagDays,
      });
      return this.listDependencies(projectId, tenantId, em);
    });
  }

  // ---------------------------------------------------- ticket links (C)

  // Every link, and each linked phase's tickets and progress. Read-only -
  // tickets are never changed here.
  async ticketProgress(projectId: number, tenantId: number) {
    await this.findProject(projectId, tenantId);
    const [links, tickets, modules, phases, percents] = await Promise.all([
      this.ticketLinksRepository.find({ where: { tenantId, projectId }, order: { id: 'ASC' } }),
      this.tasksRepository.find({
        where: { tenantId, projectId, status: Not('Junk') },
        select: ['id', 'title', 'status', 'moduleId', 'phaseId'],
      }),
      this.modulesRepository.find({ where: { tenantId, projectId } }),
      this.phasesRepository.find({ where: { tenantId, projectId } }),
      this.taskStatusConfigService.percentByStatus(tenantId),
    ]);
    const moduleName = new Map(modules.map((m) => [m.id, m.name]));
    const phaseName = new Map(phases.map((p) => [p.id, p.name]));
    const ticketTitle = new Map(tickets.map((t) => [t.id, t.title]));
    const byRow = ticketsByRow(links, tickets);
    return {
      links: links.map((l) => ({
        id: l.id,
        rowId: l.rowId,
        kind: l.taskId != null ? 'ticket' : 'module',
        moduleId: l.moduleId,
        moduleName: l.moduleId != null ? moduleName.get(l.moduleId) ?? null : null,
        phaseId: l.phaseId,
        phaseName: l.phaseId != null ? phaseName.get(l.phaseId) ?? null : null,
        taskId: l.taskId,
        taskTitle: l.taskId != null ? ticketTitle.get(l.taskId) ?? null : null,
      })),
      rows: [...byRow].map(([rowId, list]) => ({
        rowId,
        progress: rowProgress(list, percents),
        tickets: list.map((t) => ({ id: t.id, title: t.title, status: t.status, percent: percentFor(t.status, percents) })),
      })),
    };
  }

  // The project's app Modules and their Phases, for the link picker.
  async ticketLinkOptions(projectId: number, tenantId: number) {
    await this.findProject(projectId, tenantId);
    const [modules, phases] = await Promise.all([
      this.modulesRepository.find({ where: { tenantId, projectId }, order: { name: 'ASC' } }),
      this.phasesRepository.find({ where: { tenantId, projectId }, order: { name: 'ASC' } }),
    ]);
    return modules.map((m) => ({
      id: m.id,
      name: m.name,
      isActive: m.isActive,
      phases: phases.filter((p) => p.moduleId === m.id).map((p) => ({ id: p.id, name: p.name, isActive: p.isActive })),
    }));
  }

  // This project's tickets by #id or title words (Junk left out), max 20.
  async searchTickets(projectId: number, q: string, tenantId: number) {
    await this.findProject(projectId, tenantId);
    const text = (q || '').trim();
    if (!text) return [];
    const qb = this.tasksRepository
      .createQueryBuilder('t')
      .select(['t.id', 't.title', 't.status', 't.moduleName', 't.phaseName'])
      .where('t."tenantId" = :tenantId AND t."projectId" = :projectId AND t.status <> :junk', { tenantId, projectId, junk: 'Junk' });
    const id = Number(text.replace(/^#/, ''));
    const like = `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    if (Number.isInteger(id) && id > 0) qb.andWhere('(t.id = :id OR t.title ILIKE :like)', { id, like });
    else qb.andWhere('t.title ILIKE :like', { like });
    const rows = await qb.orderBy('t.id', 'DESC').limit(20).getMany();
    return rows.map((t) => ({ id: t.id, title: t.title, status: t.status, moduleName: t.moduleName, phaseName: t.phaseName }));
  }

  async addTicketLink(projectId: number, dto: CreateTimelineTicketLinkDto, actor: Actor, tenantId: number) {
    const byTicket = dto.taskId != null;
    if (byTicket === (dto.moduleId != null) || (byTicket && dto.phaseId != null)) {
      throw new BadRequestException('Link either one ticket, or a module (with or without a phase).');
    }
    if (!byTicket && dto.moduleId == null) throw new BadRequestException('Choose a module.');
    return this.dataSource.transaction(async (em) => {
      await this.findProject(projectId, tenantId, em);
      await this.lockPlan(em, tenantId, projectId);
      const row = await this.findPlanRow(em, dto.rowId, projectId, tenantId);
      const details: Record<string, unknown> = { projectId, row: { id: row.id, module: row.module, phase: row.phase } };
      if (byTicket) {
        const task = await em.getRepository(ProjectTask).findOne({ where: { id: dto.taskId!, tenantId, projectId } });
        if (!task || task.status === 'Junk') throw new BadRequestException(`Ticket #${dto.taskId} is not in this project.`);
        details.ticket = { id: task.id, title: task.title };
      } else {
        const mod = await em.getRepository(ProjectModule).findOne({ where: { id: dto.moduleId!, tenantId, projectId } });
        if (!mod) throw new BadRequestException('That module is not in this project.');
        details.module = { id: mod.id, name: mod.name };
        if (dto.phaseId != null) {
          const ph = await em.getRepository(Phase).findOne({ where: { id: dto.phaseId, tenantId, projectId, moduleId: mod.id } });
          if (!ph) throw new BadRequestException('That phase is not in this module.');
          details.phase = { id: ph.id, name: ph.name };
        }
      }
      const repo = em.getRepository(ProjectTimelineTicketLink);
      const dup = await repo.findOne({
        where: byTicket
          ? { rowId: row.id, taskId: dto.taskId! }
          : { rowId: row.id, moduleId: dto.moduleId!, phaseId: dto.phaseId ?? IsNull(), taskId: IsNull() },
      });
      if (dup) throw new ConflictException('That link is already on this phase.');
      const saved = await repo.save(
        repo.create({ tenantId, projectId, rowId: row.id, moduleId: dto.moduleId ?? null, phaseId: dto.phaseId ?? null, taskId: dto.taskId ?? null, createdByUserId: actor.id }),
      );
      await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_TICKET_LINK_ADDED, 'ProjectTimelineTicketLink', saved.id, details);
      return saved.id;
    }).then(() => this.ticketProgress(projectId, tenantId));
  }

  async removeTicketLink(projectId: number, linkId: number, actor: Actor, tenantId: number) {
    await this.dataSource.transaction(async (em) => {
      await this.findProject(projectId, tenantId, em);
      await this.lockPlan(em, tenantId, projectId);
      const repo = em.getRepository(ProjectTimelineTicketLink);
      const link = await repo.findOne({ where: { id: linkId, tenantId, projectId } });
      if (!link) throw new NotFoundException('Link not found.');
      const row = await em.getRepository(ProjectTimelineRow).findOne({ where: { id: link.rowId } });
      await repo.delete({ id: link.id });
      await this.audit(em, actor, tenantId, AuditActions.PROJECT_TIMELINE_TICKET_LINK_REMOVED, 'ProjectTimelineTicketLink', link.id, {
        projectId,
        row: { id: link.rowId, module: row?.module ?? null, phase: row?.phase ?? null },
        moduleId: link.moduleId,
        phaseId: link.phaseId,
        taskId: link.taskId,
      });
    });
    return this.ticketProgress(projectId, tenantId);
  }

  private async findPlanRow(em: EntityManager, id: number, projectId: number, tenantId: number) {
    const row = await em.getRepository(ProjectTimelineRow).findOne({ where: { id, projectId, tenantId } });
    if (!row) throw new BadRequestException(`Phase #${id} is not in this project's plan.`);
    return row;
  }

  private async depNames(em: EntityManager, dep: ProjectTimelineDependency, projectId: number, tenantId: number) {
    const rows = await em.getRepository(ProjectTimelineRow).find({ where: { projectId, tenantId } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const name = (id: number) => ({ id, module: byId.get(id)?.module ?? null, phase: byId.get(id)?.phase ?? null });
    return { predecessor: name(dep.predecessorRowId), successor: name(dep.successorRowId) };
  }

  private diffValues(before: Record<Field, unknown>, after: Record<Field, unknown>) {
    const changes: Partial<Record<Field, { old: unknown; new: unknown }>> = {};
    for (const key of Object.keys(after) as Field[]) {
      if (before[key] !== after[key]) changes[key] = { old: before[key], new: after[key] };
    }
    return changes;
  }

  private audit(em: EntityManager, actor: Actor, tenantId: number, action: string, entityType: string, entityId: number, details: Record<string, unknown>) {
    return this.auditLogService.recordWithin(em, {
      tenantId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action,
      entityType,
      entityId,
      details,
    });
  }
}

