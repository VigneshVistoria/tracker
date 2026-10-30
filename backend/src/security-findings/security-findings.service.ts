import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, Repository } from 'typeorm';
import { SecurityFinding } from './security-finding.entity';
import { Project } from '../projects/project.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { DEVELOPER_EQUIVALENT_ROLES, User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { PerformanceTrackingService } from '../performance-tracking/performance-tracking.service';
import { PerformanceMetricsService } from '../performance-metrics/performance-metrics.service';
import { addWorkingDays } from '../performance-metrics/working-days';
import { dateInZone } from '../team-settings/time-zone';
import {
  RISK_REASON_MIN,
  SECURITY_AUDIT,
  SECURITY_MANAGE_ROLES,
  SECURITY_SEE_ALL_ROLES,
  SEVERITIES,
  SecurityFindingEvent,
  Severity,
  slaBreached,
} from './security-findings';
import { AcceptSecurityRiskDto, CreateSecurityFindingDto, SubmitSecurityFixDto, UpdateSecurityFindingDto, VerifySecurityFixDto } from './dto/security-findings.dto';

const nameOf = (u: User | undefined) => (u ? u.fullName || u.email : 'Unknown');
const clean = (v: string | null | undefined) => (v ?? '').trim() || null;

// Performance Tracking P3/P4 - security findings. See ./security-findings.ts.
@Injectable()
export class SecurityFindingsService {
  constructor(
    @InjectRepository(SecurityFinding) private findings: Repository<SecurityFinding>,
    @InjectRepository(User) private users: Repository<User>,
    private tracking: PerformanceTrackingService,
    private metrics: PerformanceMetricsService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
    private dataSource: DataSource,
  ) {}

  private async calendar(tenantId: number) {
    const s = await this.metrics.getSettings(tenantId);
    const holidays = (await this.metrics.listHolidays(tenantId)).map((h) => h.date);
    return { timeZone: s.timeZone, weekendDays: s.weekendDays, holidays: new Set(holidays) };
  }

  // Developer, Designer and DevOps - the people who can own a finding (smoke-test user left out).
  private async measured(tenantId: number) {
    const people = await this.users.find({ where: { tenantId, role: In(DEVELOPER_EQUIVALENT_ROLES) }, order: { fullName: 'ASC' } });
    return people.filter((u) => u.email !== process.env.SMOKE_TEST_EMAIL);
  }

  private async access(user: User, tenantId: number) {
    const th = await this.tracking.thresholds(tenantId);
    const isSecurity = th.securityRoles.includes(user.role);
    const seesAll = isSecurity || SECURITY_SEE_ALL_ROLES.includes(user.role);
    if (!seesAll && !DEVELOPER_EQUIVALENT_ROLES.includes(user.role)) throw new ForbiddenException('You cannot see security findings.');
    return { th, isSecurity, seesAll, canManage: SECURITY_MANAGE_ROLES.includes(user.role) };
  }

  async list(user: User, tenantId: number) {
    const { th, isSecurity, seesAll, canManage } = await this.access(user, tenantId);
    const cal = await this.calendar(tenantId);
    const today = dateInZone(new Date(), cal.timeZone);
    const rows = await this.findings.find({ where: { tenantId, ...(seesAll ? {} : { ownerUserId: user.id }) }, order: { foundOn: 'DESC', id: 'DESC' } });
    const ids = new Set<number>(rows.flatMap((r) => [r.ownerUserId, r.createdByUserId, r.verifiedByUserId, r.riskAcceptedByUserId].filter((x): x is number => x != null)));
    const names = new Map((ids.size ? await this.users.find({ where: { tenantId, id: In([...ids]) } }) : []).map((u) => [u.id, u]));
    const projects = await this.dataSource.getRepository(Project).find({ where: { tenantId, performanceTrackingEnabled: true }, order: { name: 'ASC' } });
    const projectNames = new Map(
      (rows.length ? await this.dataSource.getRepository(Project).find({ where: { tenantId, id: In([...new Set(rows.map((r) => r.projectId))]) } }) : []).map((p) => [p.id, p.name]),
    );
    const people = isSecurity ? await this.measured(tenantId) : [];
    const day = (t: Date) => dateInZone(t, cal.timeZone);
    return {
      today,
      slaDays: th.securitySlaDays,
      severities: SEVERITIES,
      canRecord: isSecurity && projects.length > 0,
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      people: people.map((p) => ({ id: p.id, name: nameOf(p) })),
      findings: rows.map((r) => {
        const active = r.status === 'open' || r.status === 'fix_submitted';
        const isOwner = r.ownerUserId === user.id;
        return {
          id: r.id,
          projectId: r.projectId,
          projectName: projectNames.get(r.projectId) ?? `Project #${r.projectId}`,
          taskId: r.taskId,
          title: r.title,
          severity: r.severity,
          source: r.source,
          details: r.details,
          ownerUserId: r.ownerUserId,
          ownerName: nameOf(names.get(r.ownerUserId)),
          foundOn: r.foundOn,
          dueOn: r.dueOn,
          status: r.status,
          assignedOn: r.assignedOn,
          ownerDueOn: r.ownerDueOn,
          // The finding's own SLA (from the found date) - shown, not charged.
          slaMissed: slaBreached(r, r.dueOn, today, day),
          // The owner's (from assignment) - what P4 charges. null = risk accepted.
          ownerBreached: slaBreached(r, r.ownerDueOn, today, day),
          fixSubmittedAt: r.fixSubmittedAt,
          fixNote: r.fixNote,
          verifyAttempts: r.verifyAttempts,
          firstVerifyResult: r.firstVerifyResult,
          verifiedAt: r.verifiedAt,
          verifiedByName: r.verifiedByUserId ? nameOf(names.get(r.verifiedByUserId)) : null,
          riskAcceptedAt: r.riskAcceptedAt,
          riskAcceptedByName: r.riskAcceptedByUserId ? nameOf(names.get(r.riskAcceptedByUserId)) : null,
          riskReason: r.riskReason,
          createdByName: nameOf(names.get(r.createdByUserId)),
          createdAt: r.createdAt,
          canEdit: isSecurity && active,
          canSubmitFix: r.status === 'open' && (isOwner || canManage),
          canVerify: r.status === 'fix_submitted' && isSecurity && !isOwner,
          canAcceptRisk: active && canManage,
        };
      }),
    };
  }

  // The project a finding belongs to: its task's, else the one picked. Must be tracked.
  private async projectFor(taskId: number | null | undefined, projectId: number | null | undefined, tenantId: number) {
    let id = projectId ?? null;
    if (taskId) {
      const task = await this.dataSource.getRepository(ProjectTask).findOne({ where: { id: taskId, tenantId } });
      if (!task || task.status === 'Junk') throw new BadRequestException(`Task #${taskId} not found.`);
      id = task.projectId;
    }
    if (!id) throw new BadRequestException('Pick the project (or give a task number).');
    const project = await this.dataSource.getRepository(Project).findOne({ where: { id, tenantId } });
    if (!project?.performanceTrackingEnabled) throw new BadRequestException('Performance Tracking is off for that project.');
    return project.id;
  }

  private async owner(ownerUserId: number, tenantId: number) {
    const owner = (await this.measured(tenantId)).find((p) => p.id === ownerUserId);
    if (!owner) throw new BadRequestException('The owner must be a Developer, Designer or DevOps account.');
    return owner;
  }

  private async foundOnOk(foundOn: string, tenantId: number) {
    const cal = await this.calendar(tenantId);
    const day = foundOn.slice(0, 10);
    if (day > dateInZone(new Date(), cal.timeZone)) throw new BadRequestException('Found on cannot be in the future.');
    return { day, cal };
  }

  private audit(em: any, user: User, tenantId: number, action: string, findingId: number, details: Record<string, unknown>) {
    return this.auditLogService.recordWithin(em, {
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action,
      tenantId,
      entityType: 'SecurityFinding',
      entityId: findingId,
      details,
    });
  }

  private notify(kind: SecurityFindingEvent['kind'], f: SecurityFinding, user: User) {
    const e: SecurityFindingEvent = {
      tenantId: f.tenantId,
      kind,
      findingId: f.id,
      title: f.title,
      severity: f.severity,
      dueOn: f.dueOn,
      ownerUserId: f.ownerUserId,
      actorUserId: user.id,
      actorEmail: user.email,
    };
    this.eventEmitter.emit('security.finding', e);
  }

  async create(dto: CreateSecurityFindingDto, user: User, tenantId: number) {
    const { th, isSecurity } = await this.access(user, tenantId);
    if (!isSecurity) throw new ForbiddenException('Your role cannot record security findings.');
    const owner = await this.owner(dto.ownerUserId, tenantId);
    const projectId = await this.projectFor(dto.taskId, dto.projectId, tenantId);
    const { day, cal } = await this.foundOnOk(dto.foundOn, tenantId);
    const assignedOn = dateInZone(new Date(), cal.timeZone);
    const sla = th.securitySlaDays[dto.severity];
    const saved = await this.dataSource.transaction(async (em) => {
      const row = await em.save(
        em.create(SecurityFinding, {
          tenantId,
          projectId,
          taskId: dto.taskId ?? null,
          title: dto.title.trim(),
          severity: dto.severity,
          source: clean(dto.source),
          details: clean(dto.details),
          ownerUserId: owner.id,
          foundOn: day,
          dueOn: addWorkingDays(day, sla, cal),
          assignedOn,
          ownerDueOn: addWorkingDays(assignedOn, sla, cal),
          status: 'open',
          createdByUserId: user.id,
        }),
      );
      await this.audit(em, user, tenantId, SECURITY_AUDIT.CREATED, row.id, {
        projectId,
        taskId: row.taskId,
        title: row.title,
        severity: row.severity,
        ownerUserId: row.ownerUserId,
        foundOn: row.foundOn,
        dueOn: row.dueOn,
        assignedOn: row.assignedOn,
        ownerDueOn: row.ownerDueOn,
      });
      return row;
    });
    this.notify('created', saved, user);
    return this.list(user, tenantId);
  }

  private async find(id: number, tenantId: number) {
    const f = await this.findings.findOne({ where: { id, tenantId } });
    if (!f) throw new NotFoundException(`Finding #${id} not found.`);
    return f;
  }

  async update(id: number, dto: UpdateSecurityFindingDto, user: User, tenantId: number) {
    const { th, isSecurity } = await this.access(user, tenantId);
    if (!isSecurity) throw new ForbiddenException('Your role cannot edit security findings.');
    const f = await this.find(id, tenantId);
    if (f.status !== 'open' && f.status !== 'fix_submitted') throw new BadRequestException('A verified or risk-accepted finding can no longer be edited.');
    const changes: Partial<SecurityFinding> = {};
    if (dto.title !== undefined) changes.title = dto.title.trim();
    if (dto.source !== undefined) changes.source = clean(dto.source);
    if (dto.details !== undefined) changes.details = clean(dto.details);
    if (dto.ownerUserId !== undefined) changes.ownerUserId = (await this.owner(dto.ownerUserId, tenantId)).id;
    if (dto.severity !== undefined) changes.severity = dto.severity;
    if (dto.foundOn !== undefined) changes.foundOn = (await this.foundOnOk(dto.foundOn, tenantId)).day;
    const cal = await this.calendar(tenantId);
    const sla = th.securitySlaDays[(changes.severity ?? f.severity) as Severity];
    if (changes.severity !== undefined || changes.foundOn !== undefined) changes.dueOn = addWorkingDays(changes.foundOn ?? f.foundOn, sla, cal);
    // A new owner gets the full SLA from today.
    const reassigned = changes.ownerUserId !== undefined && changes.ownerUserId !== f.ownerUserId;
    if (reassigned) changes.assignedOn = dateInZone(new Date(), cal.timeZone);
    if (reassigned || changes.severity !== undefined) changes.ownerDueOn = addWorkingDays(changes.assignedOn ?? f.assignedOn, sla, cal);
    const keys = (Object.keys(changes) as (keyof SecurityFinding)[]).filter((k) => ((f as any)[k] ?? null) !== ((changes as any)[k] ?? null));
    if (keys.length === 0) return this.list(user, tenantId);
    const before = Object.fromEntries(keys.map((k) => [k, (f as any)[k] ?? null]));
    const after = Object.fromEntries(keys.map((k) => [k, (changes as any)[k] ?? null]));
    await this.dataSource.transaction(async (em) => {
      await em.update(SecurityFinding, { id: f.id, tenantId }, Object.fromEntries(keys.map((k) => [k, (changes as any)[k]])));
      await this.audit(em, user, tenantId, SECURITY_AUDIT.UPDATED, f.id, { before, after });
    });
    if (after.ownerUserId) this.notify('created', { ...f, ...changes } as SecurityFinding, user);
    return this.list(user, tenantId);
  }

  async submitFix(id: number, dto: SubmitSecurityFixDto, user: User, tenantId: number) {
    const { canManage } = await this.access(user, tenantId);
    const f = await this.find(id, tenantId);
    if (f.ownerUserId !== user.id && !canManage) throw new ForbiddenException('Only the owner, a Program Manager or an Admin can submit the fix.');
    if (f.status !== 'open') throw new BadRequestException('Only an open finding can have a fix submitted.');
    const note = dto.note.trim();
    if (note.length < RISK_REASON_MIN) throw new BadRequestException(`Say what was fixed (at least ${RISK_REASON_MIN} characters).`);
    const now = new Date();
    await this.dataSource.transaction(async (em) => {
      await em.update(SecurityFinding, { id: f.id, tenantId }, { status: 'fix_submitted', fixSubmittedAt: now, fixNote: note });
      await this.audit(em, user, tenantId, SECURITY_AUDIT.FIX_SUBMITTED, f.id, { note, onBehalfOf: f.ownerUserId !== user.id ? f.ownerUserId : undefined });
    });
    return this.list(user, tenantId);
  }

  async verify(id: number, dto: VerifySecurityFixDto, user: User, tenantId: number) {
    const { isSecurity } = await this.access(user, tenantId);
    if (!isSecurity) throw new ForbiddenException('Your role cannot verify security fixes.');
    const f = await this.find(id, tenantId);
    if (f.ownerUserId === user.id) throw new ForbiddenException('You cannot verify your own fix.');
    if (f.status !== 'fix_submitted') throw new BadRequestException('There is no fix waiting for verification.');
    const note = clean(dto.note);
    if (!dto.passed && (note ?? '').length < RISK_REASON_MIN) throw new BadRequestException(`Say why the fix failed (at least ${RISK_REASON_MIN} characters).`);
    const now = new Date();
    const first = f.verifyAttempts === 0;
    const changes: Partial<SecurityFinding> = {
      verifyAttempts: f.verifyAttempts + 1,
      ...(first ? { firstVerifyResult: dto.passed ? 'passed' : 'failed', firstVerifiedAt: now } : {}),
      ...(dto.passed ? { status: 'verified', fixedAt: f.fixSubmittedAt, verifiedAt: now, verifiedByUserId: user.id } : { status: 'open' }),
    };
    await this.dataSource.transaction(async (em) => {
      await em.update(SecurityFinding, { id: f.id, tenantId }, changes);
      await this.audit(em, user, tenantId, SECURITY_AUDIT.VERIFIED, f.id, { passed: dto.passed, attempt: f.verifyAttempts + 1, note });
    });
    if (!dto.passed) this.notify('failed', f, user);
    return this.list(user, tenantId);
  }

  async acceptRisk(id: number, dto: AcceptSecurityRiskDto, user: User, tenantId: number) {
    const { canManage } = await this.access(user, tenantId);
    if (!canManage) throw new ForbiddenException('Only a Program Manager or an Admin can accept the risk.');
    const f = await this.find(id, tenantId);
    if (f.status !== 'open' && f.status !== 'fix_submitted') throw new BadRequestException('This finding is already closed.');
    const reason = dto.reason.trim();
    if (reason.length < RISK_REASON_MIN) throw new BadRequestException(`Give a reason (at least ${RISK_REASON_MIN} characters).`);
    await this.dataSource.transaction(async (em) => {
      await em.update(SecurityFinding, { id: f.id, tenantId }, { status: 'risk_accepted', riskAcceptedAt: new Date(), riskAcceptedByUserId: user.id, riskReason: reason });
      await this.audit(em, user, tenantId, SECURITY_AUDIT.RISK_ACCEPTED, f.id, { reason, previousStatus: f.status });
    });
    return this.list(user, tenantId);
  }
}
