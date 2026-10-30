import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import ExcelJS from 'exceljs';
import { User, UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { PerformanceMetricsService } from '../../performance-metrics/performance-metrics.service';
import { Project } from '../../projects/project.entity';
import { PerformanceTrackingService } from '../performance-tracking.service';
import { projectTrackingPhase } from '../performance-tracking';
import { PerformanceMetricSnapshot } from '../metrics/performance-metric-snapshot.entity';
import { METRIC_INFO, TRACKING_METRICS } from '../metrics/tracking-metrics';
import { PerformanceScoreOverride } from './performance-score-override.entity';
import { ActiveOverride, COMPETENCIES, PersonScorecard, SnapshotRowLike, UNSCORED_METRICS, scorePerson } from './scoring';
import { CreateScoreOverrideDto, RemoveScoreOverrideDto } from '../dto/scorecard.dto';

// See everyone's scorecard (2026-10-30, the user's rule). A developer,
// designer or DevOps sees only their own; every other role nothing.
export const SCORECARD_ALL_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE];
// Excel export: PM and Admin only (the user's rule), audited.
export const SCORECARD_EXPORT_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
export const OVERRIDE_REASON_MIN = 10;

export const SCORECARD_AUDIT = {
  OVERRIDE_SET: 'performance_score_override_set',
  OVERRIDE_REMOVED: 'performance_score_override_removed',
  EXPORTED: 'performance_scorecard_exported',
} as const;

type Viewer = Pick<User, 'id' | 'email' | 'role' | 'tenantId'>;

// Performance Tracking B3 - the scorecard. Every visibility rule is
// checked here, whatever the screen shows. See ./scoring.ts.
@Injectable()
export class ScorecardService {
  constructor(
    @InjectRepository(PerformanceMetricSnapshot) private snapshotsRepository: Repository<PerformanceMetricSnapshot>,
    @InjectRepository(PerformanceScoreOverride) private overridesRepository: Repository<PerformanceScoreOverride>,
    private tracking: PerformanceTrackingService,
    private metrics: PerformanceMetricsService,
    private usersService: UsersService,
    private auditLogService: AuditLogService,
    private dataSource: DataSource,
  ) {}

  private seesAll(viewer: Viewer) {
    return SCORECARD_ALL_ROLES.includes(viewer.role);
  }

  // Throws unless the viewer may see this person's card.
  assertCanSee(viewer: Viewer, userId: number) {
    if (this.seesAll(viewer)) return;
    if (DEVELOPER_EQUIVALENT_ROLES.includes(viewer.role) && viewer.id === userId) return;
    throw new ForbiddenException('You can only see your own scorecard.');
  }

  private async latestDate(tenantId: number): Promise<string | null> {
    const row = await this.snapshotsRepository
      .createQueryBuilder('s')
      .select('MAX(s."snapshotDate")::text', 'd')
      .where('s."tenantId" = :tenantId', { tenantId })
      .getRawOne();
    return row?.d ?? null;
  }

  private async activeOverrides(tenantId: number, date: string, userId?: number): Promise<PerformanceScoreOverride[]> {
    return this.overridesRepository.find({
      where: { tenantId, removedAt: IsNull(), effectiveFrom: LessThanOrEqual(date), ...(userId ? { userId } : {}) },
      order: { id: 'ASC' },
    });
  }

  private toActive(o: PerformanceScoreOverride): ActiveOverride {
    return {
      id: o.id,
      metric: o.metric,
      overrideScore: o.overrideScore,
      originalScore: o.originalScore,
      reason: o.reason,
      createdByUserId: o.createdByUserId,
      createdAt: o.createdAt,
      effectiveFrom: o.effectiveFrom,
    };
  }

  // Cards for one night: everyone the viewer may see (onlyUserId narrows).
  private async build(tenantId: number, date: string | null, onlyUserId?: number) {
    const [thresholds, metricSettings, users, projects] = await Promise.all([
      this.tracking.thresholds(tenantId),
      this.metrics.getSettings(tenantId),
      this.usersService.findAll(tenantId),
      this.dataSource.getRepository(Project).find({ where: { tenantId }, order: { name: 'ASC' } }),
    ]);
    const names = new Map(users.map((u) => [u.id, { name: u.fullName || u.email, email: u.email, role: u.role }]));
    const now = new Date();
    const tracked = projects
      .filter((p) => p.performanceTrackingEnabled)
      .map((p) => ({ id: p.id, name: p.name, since: p.performanceTrackingSince ?? null, ...projectTrackingPhase(true, p.performanceTrackingSince ?? null, now, thresholds.baselineDays) }));
    const rows: SnapshotRowLike[] = date
      ? (
          await this.snapshotsRepository.find({ where: { tenantId, snapshotDate: date, ...(onlyUserId ? { userId: onlyUserId } : {}) } })
        ).map((r) => ({ ...r, value: r.value === null ? null : Number(r.value) }))
      : [];
    const overrides = date ? await this.activeOverrides(tenantId, date, onlyUserId) : [];
    const userIds = [...new Set(rows.map((r) => r.userId))].filter((id) => onlyUserId === undefined || id === onlyUserId);
    const cards: Array<PersonScorecard & { name: string; email: string; role: string }> = userIds
      .map((userId) => ({
        ...scorePerson(userId, rows, {
          bands: thresholds,
          minSample: metricSettings.minSample,
          releaseMinSample: thresholds.releaseMinSample,
          securityMinSample: thresholds.securityMinSample,
          clientMinSample: thresholds.clientMinSample,
          overrides: overrides.filter((o) => o.userId === userId).map((o) => this.toActive(o)),
        }),
        name: names.get(userId)?.name ?? `User #${userId}`,
        email: names.get(userId)?.email ?? '',
        role: names.get(userId)?.role ?? '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      snapshotDate: date,
      projects: tracked,
      minSample: metricSettings.minSample,
      release: { windowDays: thresholds.releaseWindowDays, minSample: thresholds.releaseMinSample },
      security: { windowDays: thresholds.securityWindowDays, minSample: thresholds.securityMinSample },
      client: { windowDays: thresholds.clientWindowDays, minSample: thresholds.clientMinSample },
      bands: { percentBands: thresholds.percentBands, breachBands: thresholds.breachBands },
      nonComplianceDisplay: thresholds.nonComplianceDisplay,
      overrideUserIds: thresholds.overrideUserIds,
      competencies: Object.entries(COMPETENCIES).map(([key, c]) => ({ key, label: c.label, metrics: c.metrics })),
      metricInfo: TRACKING_METRICS.map((m) => ({ metric: m, ...METRIC_INFO[m], scored: !UNSCORED_METRICS.includes(m) })),
      cards,
      rows,
      names,
    };
  }

  async list(viewer: Viewer, date?: string) {
    if (!this.seesAll(viewer) && !DEVELOPER_EQUIVALENT_ROLES.includes(viewer.role)) {
      throw new ForbiddenException('The scorecard is not available for your role.');
    }
    const tenantId = viewer.tenantId;
    const night = date ?? (await this.latestDate(tenantId));
    const built = await this.build(tenantId, night, this.seesAll(viewer) ? undefined : viewer.id);
    const { rows, names, ...rest } = built;
    return {
      ...rest,
      seesEveryone: this.seesAll(viewer),
      canExport: SCORECARD_EXPORT_ROLES.includes(viewer.role),
      canOverride: built.overrideUserIds.includes(viewer.id),
      // No per-metric details in the list - see person().
      cards: built.cards.map(({ metrics, ...card }) => ({ ...card, metrics: metrics.map(({ projects, ...m }) => m) })),
    };
  }

  // One card with the raw details behind each metric, per project.
  async person(viewer: Viewer, userId: number, date?: string) {
    this.assertCanSee(viewer, userId);
    const tenantId = viewer.tenantId;
    const target = await this.usersService.findByIdAndTenant(userId, tenantId);
    if (!target) throw new NotFoundException(`User #${userId} not found`);
    const night = date ?? (await this.latestDate(tenantId));
    const built = await this.build(tenantId, night, userId);
    const card = built.cards[0] ?? null;
    const history = await this.overridesRepository.find({ where: { tenantId, userId }, order: { createdAt: 'DESC', id: 'DESC' } });
    const nameOf = (id: number | null) => (id ? built.names.get(id)?.name ?? `User #${id}` : null);
    return {
      snapshotDate: built.snapshotDate,
      projects: built.projects,
      minSample: built.minSample,
      bands: built.bands,
      metricInfo: built.metricInfo,
      competencies: built.competencies,
      canOverride: built.overrideUserIds.includes(viewer.id) && viewer.id !== userId,
      user: { id: target.id, name: target.fullName || target.email, email: target.email, role: target.role },
      card,
      details: built.rows.map((r) => ({ projectId: r.projectId, metric: r.metric, phase: r.phase, value: r.value, sample: r.sample, details: r.details })),
      overrideHistory: history.map((o) => ({ ...o, createdByName: nameOf(o.createdByUserId), removedByName: nameOf(o.removedByUserId) })),
    };
  }

  async setOverride(viewer: Viewer, dto: CreateScoreOverrideDto) {
    const tenantId = viewer.tenantId;
    const { overrideUserIds } = await this.tracking.thresholds(tenantId);
    if (!overrideUserIds.includes(viewer.id)) throw new ForbiddenException('Only the people named in Performance Tracking Settings can override scores.');
    if (viewer.id === dto.userId) throw new ForbiddenException('You cannot override your own score.');
    if (UNSCORED_METRICS.includes(dto.metric)) throw new BadRequestException(`${dto.metric} is not scored, so it cannot be overridden.`);
    const reason = (dto.reason || '').trim();
    if (reason.length < OVERRIDE_REASON_MIN) throw new BadRequestException(`The reason must be at least ${OVERRIDE_REASON_MIN} characters.`);
    const target = await this.usersService.findByIdAndTenant(dto.userId, tenantId);
    if (!target) throw new NotFoundException(`User #${dto.userId} not found`);
    const night = await this.latestDate(tenantId);
    if (!night) throw new BadRequestException('There are no scores yet to override.');
    const built = await this.build(tenantId, night, dto.userId);
    const card = built.cards[0];
    if (!card || card.state === 'baseline') throw new BadRequestException('This person has no scores yet (Baseline or no data), so there is nothing to override.');
    const metric = card.metrics.find((m) => m.metric === dto.metric)!;
    // The computed score is kept, whatever an earlier override said.
    const originalScore = metric.computedScore;

    let overrideId = 0;
    await this.dataSource.transaction(async (em) => {
      const existing = await em.findOne(PerformanceScoreOverride, { where: { tenantId, userId: dto.userId, metric: dto.metric, removedAt: IsNull() } });
      if (existing) {
        await em.update(PerformanceScoreOverride, { id: existing.id }, { removedAt: new Date(), removedByUserId: viewer.id, removeReason: 'Replaced by a new override' });
      }
      const inserted = await em.insert(PerformanceScoreOverride, {
        tenantId,
        userId: dto.userId,
        metric: dto.metric,
        effectiveFrom: night,
        originalScore,
        overrideScore: dto.score,
        reason,
        createdByUserId: viewer.id,
      });
      overrideId = inserted.identifiers[0].id;
      await this.auditLogService.recordWithin(em, {
        userId: viewer.id,
        userEmail: viewer.email,
        userRole: viewer.role,
        action: SCORECARD_AUDIT.OVERRIDE_SET,
        tenantId,
        entityType: 'User',
        entityId: dto.userId,
        details: { overrideId, metric: dto.metric, originalScore, overrideScore: dto.score, reason, effectiveFrom: night, replacedOverrideId: existing?.id ?? null },
      });
    });
    return this.person(viewer, dto.userId);
  }

  async removeOverride(viewer: Viewer, overrideId: number, dto: RemoveScoreOverrideDto) {
    const tenantId = viewer.tenantId;
    const { overrideUserIds } = await this.tracking.thresholds(tenantId);
    if (!overrideUserIds.includes(viewer.id)) throw new ForbiddenException('Only the people named in Performance Tracking Settings can override scores.');
    const o = await this.overridesRepository.findOne({ where: { id: overrideId, tenantId } });
    if (!o) throw new NotFoundException(`Override #${overrideId} not found`);
    if (o.removedAt) throw new BadRequestException('This override is already removed - reload to see it.');
    if (viewer.id === o.userId) throw new ForbiddenException('You cannot change an override on your own score.');
    const reason = (dto.reason || '').trim();
    if (reason.length < OVERRIDE_REASON_MIN) throw new BadRequestException(`The reason must be at least ${OVERRIDE_REASON_MIN} characters.`);
    await this.dataSource.transaction(async (em) => {
      const updated = await em.update(PerformanceScoreOverride, { id: o.id, removedAt: IsNull() }, { removedAt: new Date(), removedByUserId: viewer.id, removeReason: reason });
      if (!updated.affected) throw new BadRequestException('This override was just removed - reload to see it.');
      await this.auditLogService.recordWithin(em, {
        userId: viewer.id,
        userEmail: viewer.email,
        userRole: viewer.role,
        action: SCORECARD_AUDIT.OVERRIDE_REMOVED,
        tenantId,
        entityType: 'User',
        entityId: o.userId,
        details: { overrideId: o.id, metric: o.metric, overrideScore: o.overrideScore, originalScore: o.originalScore, reason },
      });
    });
    return this.person(viewer, o.userId);
  }

  // Long format, one row per person per metric - for Excel and the feed.
  async flatRows(tenantId: number, date?: string) {
    const night = date ?? (await this.latestDate(tenantId));
    const built = await this.build(tenantId, night);
    const out: Array<Record<string, string | number | null>> = [];
    for (const c of built.cards) {
      for (const m of c.metrics) {
        out.push({
          snapshotDate: night,
          userId: c.userId,
          name: c.name,
          email: c.email,
          role: c.role,
          cardState: c.state,
          overall: c.overall,
          metric: m.metric,
          label: m.label,
          state: m.state,
          value: m.value,
          sample: m.sample,
          score: m.score,
          computedScore: m.computedScore,
          overrideReason: m.override?.reason ?? null,
        });
      }
    }
    return { snapshotDate: night, built, rows: out };
  }

  async exportExcel(viewer: Viewer, date?: string): Promise<{ buffer: Buffer; filename: string }> {
    if (!SCORECARD_EXPORT_ROLES.includes(viewer.role)) throw new ForbiddenException('Only a Program Manager or Admin can export the scorecard.');
    const tenantId = viewer.tenantId;
    const { snapshotDate, built, rows } = await this.flatRows(tenantId, date);
    const STATE = { baseline: 'Baseline - no scores yet', not_enough_data: 'Not enough data', scored: 'Scored', not_scored: 'Shown, not scored' } as Record<string, string>;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Tracker';
    const summary = wb.addWorksheet('Scorecard');
    summary.columns = [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Role', key: 'role', width: 14 },
      { header: 'Status', key: 'state', width: 24 },
      { header: 'Overall', key: 'overall', width: 10 },
      ...built.competencies.map((c) => ({ header: c.label, key: `c_${c.key}`, width: 14 })),
    ];
    for (const c of built.cards) {
      summary.addRow({
        name: c.name,
        email: c.email,
        role: c.role,
        state: STATE[c.state],
        overall: c.overall,
        ...Object.fromEntries(c.competencies.map((x) => [`c_${x.key}`, x.score])),
      });
    }
    const detail = wb.addWorksheet('Metrics');
    detail.columns = [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Metric', key: 'metric', width: 8 },
      { header: 'Measure', key: 'label', width: 30 },
      { header: 'Status', key: 'state', width: 24 },
      { header: 'Value', key: 'value', width: 10 },
      { header: 'Sample', key: 'sample', width: 10 },
      { header: 'Score', key: 'score', width: 8 },
      { header: 'Computed score', key: 'computedScore', width: 16 },
      { header: 'Override reason', key: 'overrideReason', width: 40 },
    ];
    for (const r of rows) detail.addRow({ ...r, state: STATE[String(r.state)] ?? r.state });
    for (const ws of [summary, detail]) ws.getRow(1).font = { bold: true };
    const about = wb.addWorksheet('About');
    about.addRows([
      ['Night', snapshotDate ?? 'no data yet'],
      ['Projects tracked', built.projects.map((p) => `${p.name} (${p.phase === 'baseline' ? 'Baseline' : 'Scoring'})`).join(', ') || 'none'],
      ['Minimum sample', built.minSample],
      ['P1/P2 window (days) and minimum releases', `${built.release.windowDays} days, ${built.release.minSample} releases`],
      ['P3/P4 window (days) and minimum verified fixes (P3)', `${built.security.windowDays} days, ${built.security.minSample} fixes`],
      ['L4/L5 window (days) and minimum (UAT tasks / release responses)', `${built.client.windowDays} days, ${built.client.minSample}`],
      ['Percent bands (score 5/4/3/2)', built.bands.percentBands.join(' / ')],
      ['Breach bands (score 5/4/3/2)', built.bands.breachBands.join(' / ')],
      ['Note', 'Personal performance data - handle as confidential.'],
    ]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await this.auditLogService.record({
      userId: viewer.id,
      userEmail: viewer.email,
      userRole: viewer.role,
      action: SCORECARD_AUDIT.EXPORTED,
      tenantId,
      entityType: 'PerformanceScorecard',
      entityId: tenantId,
      details: { snapshotDate, people: built.cards.length, format: 'xlsx' },
    });
    return { buffer, filename: `performance-scorecard-${snapshotDate ?? 'empty'}.xlsx` };
  }

  // Whether the developer top-bar link should show at all.
  async anyTracking(tenantId: number): Promise<boolean> {
    return (await this.dataSource.getRepository(Project).count({ where: { tenantId, performanceTrackingEnabled: true } })) > 0;
  }
}

