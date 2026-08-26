import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SlaConfig, SlaTargetKey } from './sla-config.entity';
import { Issue, IssueStatus } from '../issues/issue.entity';
import { Priority } from '../common/priority.enum';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

const HOUR_MS = 60 * 60 * 1000;

// Fallback only used if a key is somehow missing from the table (it
// shouldn't be - the migration seeds all six) - keeps SLA computation
// from ever throwing mid-request over a data gap.
const FALLBACK_TARGET_HOURS = 72;

const PRIORITY_TO_SLA_KEY: Record<Priority, SlaTargetKey> = {
  [Priority.CRITICAL]: SlaTargetKey.CRITICAL,
  [Priority.HIGH]: SlaTargetKey.HIGH,
  [Priority.MEDIUM]: SlaTargetKey.MEDIUM,
  [Priority.LOW]: SlaTargetKey.LOW,
};

// Display order for the config page - most urgent first.
export const SLA_KEY_ORDER: SlaTargetKey[] = [
  SlaTargetKey.SHOWSTOPPER,
  SlaTargetKey.CRITICAL,
  SlaTargetKey.HIGH,
  SlaTargetKey.MEDIUM,
  SlaTargetKey.LOW,
  SlaTargetKey.DEFAULT,
];

export type SlaState = 'On Track' | 'Near Due' | 'At Risk' | 'Breached' | 'Met';

export interface SlaInfo {
  targetKey: SlaTargetKey;
  targetHours: number;
  dueAt: string;
  state: SlaState;
}

@Injectable()
export class SlaService {
  constructor(
    @InjectRepository(SlaConfig)
    private slaConfigRepository: Repository<SlaConfig>,
    private auditLogService: AuditLogService,
  ) {}

  async getConfig(): Promise<SlaConfig[]> {
    const rows = await this.slaConfigRepository.find();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return SLA_KEY_ORDER.map((key) => byKey.get(key)).filter((r): r is SlaConfig => Boolean(r));
  }

  async updateTarget(
    key: SlaTargetKey,
    targetHours: number,
    user: { id: number; email: string },
  ): Promise<SlaConfig> {
    const existing = await this.slaConfigRepository.findOne({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`No SLA config row for "${key}" - the migration should have seeded it`);
    }
    const previousTargetHours = existing.targetHours;

    existing.targetHours = targetHours;
    existing.updatedByUserId = user.id;
    existing.updatedByEmail = user.email;
    const saved = await this.slaConfigRepository.save(existing);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.SLA_CONFIG_UPDATED,
      entityType: 'SlaConfig',
      entityId: saved.id,
      details: { key, previousTargetHours, newTargetHours: targetHours },
    });

    return saved;
  }

  // Precedence: an explicit Showstopper always overrides priority (a
  // Critical-priority showstopper is still governed by the Showstopper
  // target, not the Critical one - it's the more urgent of the two by
  // definition). Otherwise resolves by priority, falling back to Default
  // for issues with no priority set.
  private resolveTargetKey(issue: Pick<Issue, 'showstopper' | 'priority'>): SlaTargetKey {
    if (issue.showstopper) return SlaTargetKey.SHOWSTOPPER;
    if (issue.priority && PRIORITY_TO_SLA_KEY[issue.priority]) return PRIORITY_TO_SLA_KEY[issue.priority];
    return SlaTargetKey.DEFAULT;
  }

  // Computed fresh every call, never stored on the issue - same "derived,
  // can't go stale" approach as the project drill-down's completion/risk
  // figures. Needs the full config set passed in (rather than querying
  // per-issue) so callers building a whole list of issues aren't hitting
  // the DB once per row.
  computeForIssue(issue: Issue, config: SlaConfig[]): SlaInfo {
    const targetKey = this.resolveTargetKey(issue);
    const targetHours = config.find((c) => c.key === targetKey)?.targetHours ?? FALLBACK_TARGET_HOURS;
    const createdAt = new Date(issue.createdAt);
    const dueAt = new Date(createdAt.getTime() + targetHours * HOUR_MS);

    const isClosed = issue.status === IssueStatus.READY_FOR_PRODUCTION;
    const referenceTime = isClosed && issue.closedOn ? new Date(issue.closedOn) : new Date();

    let state: SlaState;
    if (isClosed) {
      state = referenceTime <= dueAt ? 'Met' : 'Breached';
    } else if (referenceTime > dueAt) {
      state = 'Breached';
    } else {
      const targetMs = targetHours * HOUR_MS;
      const percentElapsed = targetMs > 0 ? (referenceTime.getTime() - createdAt.getTime()) / targetMs : 1;
      state = percentElapsed >= 0.8 ? 'At Risk' : percentElapsed >= 0.5 ? 'Near Due' : 'On Track';
    }

    return { targetKey, targetHours, dueAt: dueAt.toISOString(), state };
  }

  // Convenience for a single issue where fetching the whole config table
  // per call is acceptable (e.g. the showstopper-email trigger, which
  // fires rarely) - list endpoints should call getConfig() once and reuse
  // it across every row via computeForIssue() directly instead.
  async computeForIssueStandalone(issue: Issue): Promise<SlaInfo> {
    const config = await this.getConfig();
    return this.computeForIssue(issue, config);
  }
}
