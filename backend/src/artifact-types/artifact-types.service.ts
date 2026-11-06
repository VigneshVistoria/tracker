import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { TaskArtifactType } from '../task-qa-reviews/task-qa-review.entity';
import { DEVELOPER_EQUIVALENT_ROLES, UserRole } from '../users/user.entity';
import { ArtifactType } from './artifact-type.entity';
import { ArtifactRequirement, ArtifactTypeRule } from './artifact-type-rule.entity';

type Actor = { id: number; email: string; role: UserRole };

export const ARTIFACT_LABEL_MAX = 60;
export const ARTIFACT_TYPES_MAX = 50;

// The roles that submit work, so the only ones rules apply to.
export const ARTIFACT_RULE_ROLES: string[] = DEVELOPER_EQUIVALENT_ROLES.map((r) => r as string);
export const ARTIFACT_ROLE_LABELS: Record<string, string> = { developer: 'Developer', designer: 'Designer', devops: 'DevOps' };

// The 10 types every tenant starts with (code = label = the value already
// stored on past submissions).
export const DEFAULT_ARTIFACT_TYPE_CODES: string[] = Object.values(TaskArtifactType);

export const ARTIFACT_TYPES_AUDIT = {
  CREATED: 'artifact_type_created',
  UPDATED: 'artifact_type_updated',
  REORDERED: 'artifact_types_reordered',
  RULES_UPDATED: 'artifact_type_rules_updated',
} as const;

// Admin-configurable submission artifact types, Stage 2 (2026-11-06,
// decisions confirmed with the user): add, rename, deactivate and reorder
// types, and set per role which types are offered and which are required.
// Admin and Program Manager only (checked by SubmissionChecklistController);
// every change is in the audit log with before/after.
// Stage 2 only stores the configuration - the submit forms and the
// required-type check start using it in Stages 3 and 4.
@Injectable()
export class ArtifactTypesService {
  constructor(
    @InjectRepository(ArtifactType)
    private typesRepository: Repository<ArtifactType>,
    @InjectRepository(ArtifactTypeRule)
    private rulesRepository: Repository<ArtifactTypeRule>,
    private dataSource: DataSource,
    private auditLogService: AuditLogService,
  ) {}

  // A tenant created after the migration has no types yet: give it the 10
  // defaults the first time anything reads them. ON CONFLICT DO NOTHING on
  // (tenantId, code), so two requests at once can't double them up.
  async ensureSeeded(tenantId: number): Promise<void> {
    if ((await this.typesRepository.count({ where: { tenantId } })) > 0) return;
    await this.typesRepository
      .createQueryBuilder()
      .insert()
      .into(ArtifactType)
      .values(DEFAULT_ARTIFACT_TYPE_CODES.map((code, i) => ({ tenantId, code, label: code, sortOrder: i + 1 })))
      .orIgnore()
      .execute();
  }

  async types(tenantId: number): Promise<ArtifactType[]> {
    await this.ensureSeeded(tenantId);
    return this.typesRepository.find({ where: { tenantId }, order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  async rules(tenantId: number): Promise<ArtifactTypeRule[]> {
    return this.rulesRepository.find({ where: { tenantId }, order: { role: 'ASC', artifactTypeId: 'ASC' } });
  }

  // Stage 3 (2026-11-06): the submitter's role's REQUIRED types that this
  // submission doesn't include - [] when nothing is required (no rules,
  // or only optional ones). Inactive types are never required. Used at
  // Ready for Feedback (TaskQaReviewsService.submit) and Peer Review
  // (PeerReviewsService.submit).
  async missingRequired(tenantId: number, role: string, submittedCodes: string[]): Promise<ArtifactType[]> {
    const required = await this.rulesRepository.find({ where: { tenantId, role, requirement: 'required' } });
    if (required.length === 0) return [];
    const types = await this.types(tenantId);
    const submitted = new Set(submittedCodes);
    return types.filter((t) => t.active && !submitted.has(t.code) && required.some((r) => r.artifactTypeId === t.id));
  }

  // 400 naming each missing required type by the name people see.
  async assertRequiredPresent(tenantId: number, role: string, submittedCodes: string[]): Promise<void> {
    const missing = await this.missingRequired(tenantId, role, submittedCodes);
    if (missing.length === 0) return;
    const names = missing.map((t) => `"${t.label}"`);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    throw new BadRequestException(
      `${list} ${missing.length === 1 ? 'is a required artifact type' : 'are required artifact types'} for your role - add ${missing.length === 1 ? 'it' : 'them'} and submit again.`,
    );
  }

  // Everything the settings section needs.
  async settingsPage(tenantId: number) {
    const [types, rules] = [await this.types(tenantId), await this.rules(tenantId)];
    return {
      types: types.map((t) => ({ id: t.id, code: t.code, label: t.label, active: t.active, sortOrder: t.sortOrder })),
      roles: ARTIFACT_RULE_ROLES.map((value) => ({ value, label: ARTIFACT_ROLE_LABELS[value] ?? value })),
      rules: rules.map((r) => ({ artifactTypeId: r.artifactTypeId, role: r.role, requirement: r.requirement })),
    };
  }

  private cleanLabel(raw: string): string {
    const label = (raw || '').trim().replace(/\s+/g, ' ');
    if (!label) throw new BadRequestException('Enter a name for the artifact type.');
    if (label.length > ARTIFACT_LABEL_MAX) throw new BadRequestException(`Artifact type names can be at most ${ARTIFACT_LABEL_MAX} characters.`);
    return label;
  }

  private async findOwn(id: number, tenantId: number): Promise<ArtifactType> {
    const type = await this.typesRepository.findOne({ where: { id, tenantId } });
    if (!type) throw new NotFoundException(`Artifact type #${id} not found`);
    return type;
  }

  private audit(actor: Actor, tenantId: number, action: string, entityId: number | undefined, details: Record<string, unknown>) {
    return this.auditLogService.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action,
      tenantId,
      entityType: 'ArtifactType',
      entityId,
      details,
    });
  }

  // The code is the label as first entered and never changes afterwards.
  async create(rawLabel: string, actor: Actor, tenantId: number) {
    const label = this.cleanLabel(rawLabel);
    const types = await this.types(tenantId);
    if (types.length >= ARTIFACT_TYPES_MAX) throw new BadRequestException(`No more than ${ARTIFACT_TYPES_MAX} artifact types.`);
    const lower = label.toLowerCase();
    const clash = types.find((t) => t.code.toLowerCase() === lower || t.label.toLowerCase() === lower);
    if (clash) {
      throw new BadRequestException(
        clash.active ? `"${clash.label}" already exists.` : `"${clash.label}" already exists but is inactive - reactivate it instead.`,
      );
    }
    const sortOrder = types.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1;
    const saved = await this.typesRepository.save(this.typesRepository.create({ tenantId, code: label, label, active: true, sortOrder }));
    await this.audit(actor, tenantId, ARTIFACT_TYPES_AUDIT.CREATED, saved.id, { code: saved.code, label: saved.label });
    return this.settingsPage(tenantId);
  }

  // Rename (label only) and/or activate / deactivate.
  async update(id: number, changes: { label?: string; active?: boolean }, actor: Actor, tenantId: number) {
    const type = await this.findOwn(id, tenantId);
    const before = { label: type.label, active: type.active };
    const after = { ...before };
    if (changes.label !== undefined) {
      const label = this.cleanLabel(changes.label);
      const others = (await this.types(tenantId)).filter((t) => t.id !== id);
      if (others.some((t) => t.label.toLowerCase() === label.toLowerCase() || t.code.toLowerCase() === label.toLowerCase())) {
        throw new BadRequestException(`Another artifact type is already called "${label}".`);
      }
      after.label = label;
    }
    if (changes.active !== undefined) after.active = changes.active;
    if (after.label === before.label && after.active === before.active) return this.settingsPage(tenantId);
    await this.typesRepository.update({ id, tenantId }, after);
    await this.audit(actor, tenantId, ARTIFACT_TYPES_AUDIT.UPDATED, id, { code: type.code, before, after });
    return this.settingsPage(tenantId);
  }

  // ids = every type of the tenant, in the new order.
  async reorder(ids: number[], actor: Actor, tenantId: number) {
    const types = await this.types(tenantId);
    const known = new Set(types.map((t) => t.id));
    if (ids.length !== types.length || new Set(ids).size !== ids.length || ids.some((i) => !known.has(i))) {
      throw new BadRequestException('The order must list every artifact type exactly once - reload the page and try again.');
    }
    const byId = new Map(types.map((t) => [t.id, t]));
    await this.dataSource.transaction(async (em) => {
      for (let i = 0; i < ids.length; i += 1) {
        await em.update(ArtifactType, { id: ids[i], tenantId }, { sortOrder: i + 1 });
      }
    });
    await this.audit(actor, tenantId, ARTIFACT_TYPES_AUDIT.REORDERED, undefined, {
      before: types.map((t) => t.code),
      after: ids.map((i) => byId.get(i)!.code),
    });
    return this.settingsPage(tenantId);
  }

  // Replaces one role's rules. An empty list = no rules = the role is
  // offered every active type, all optional.
  async setRoleRules(role: string, rules: Array<{ artifactTypeId: number; requirement: string }>, actor: Actor, tenantId: number) {
    if (!ARTIFACT_RULE_ROLES.includes(role)) {
      throw new BadRequestException(`Rules can only be set for ${ARTIFACT_RULE_ROLES.map((r) => ARTIFACT_ROLE_LABELS[r] ?? r).join(', ')}.`);
    }
    const types = await this.types(tenantId);
    const byId = new Map(types.map((t) => [t.id, t]));
    const seen = new Set<number>();
    for (const r of rules) {
      const type = byId.get(r.artifactTypeId);
      if (!type) throw new BadRequestException(`Artifact type #${r.artifactTypeId} not found.`);
      if (!type.active) throw new BadRequestException(`"${type.label}" is inactive - reactivate it before adding it to a role.`);
      if (seen.has(r.artifactTypeId)) throw new BadRequestException(`"${type.label}" is listed twice.`);
      seen.add(r.artifactTypeId);
    }
    const describe = (list: Array<{ artifactTypeId: number; requirement: string }>) =>
      list.map((r) => ({ code: byId.get(r.artifactTypeId)?.code ?? `#${r.artifactTypeId}`, requirement: r.requirement }));
    const before = await this.rulesRepository.find({ where: { tenantId, role }, order: { artifactTypeId: 'ASC' } });
    await this.dataSource.transaction(async (em) => {
      await em.delete(ArtifactTypeRule, { tenantId, role });
      if (rules.length > 0) {
        await em.insert(
          ArtifactTypeRule,
          rules.map((r) => ({ tenantId, role, artifactTypeId: r.artifactTypeId, requirement: r.requirement as ArtifactRequirement })),
        );
      }
    });
    await this.audit(actor, tenantId, ARTIFACT_TYPES_AUDIT.RULES_UPDATED, undefined, {
      role,
      before: describe(before),
      after: describe([...rules].sort((a, b) => a.artifactTypeId - b.artifactTypeId)),
    });
    return this.settingsPage(tenantId);
  }
}
