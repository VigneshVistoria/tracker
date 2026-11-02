import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditActions, AuditLogService } from '../audit/audit-log.service';
import { Project } from '../projects/project.entity';
import { Release } from '../release-logs/release.entity';
import { ReleaseLogsService } from '../release-logs/release-logs.service';
import { RELEASED_BY_ROLES } from '../release-logs/release-path';
import { PERFORMANCE_TRACKING_DEFAULTS } from '../performance-tracking/performance-tracking';
import { dateInZone } from '../team-settings/time-zone';
import { User, UserRole } from '../users/user.entity';
import { GithubApiService } from './github-api.service';
import {
  ClassifiedEvent,
  DeliveryOutcome,
  GITHUB_AUDIT,
  GITHUB_DEFAULT_TASK_KEY_PREFIX,
  GITHUB_DELIVERY_RETENTION_DAYS,
  RELEASE_KINDS,
  REPO_FULL_NAME,
  TASK_KEY_PREFIX,
  baseVersion,
  classify,
  cleanList,
  overlapProblem,
  signatureValid,
  taskRefs,
} from './github-releases';
import { GithubRepoMapping, GithubSettings, GithubStagingDeployment, GithubWebhookDelivery } from './github-releases.entity';
import { RepoMappingDto, UpdateGithubSettingsDto } from './dto/github-releases.dto';

type Actor = { id: number; email: string; role: UserRole };
const NOTES_MAX = 50;
const isUniqueViolation = (err: any) => err?.code === '23505' || err?.driverError?.code === '23505';

// P1/P2 from GitHub - see ./github-releases.ts.
@Injectable()
export class GithubReleasesService {
  private readonly logger = new Logger(GithubReleasesService.name);
  // Deliveries are processed one at a time, so two events for the same
  // release (GitHub sends "published" and "released" together) never race.
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(GithubSettings) private readonly settingsRepo: Repository<GithubSettings>,
    @InjectRepository(GithubRepoMapping) private readonly mappingsRepo: Repository<GithubRepoMapping>,
    @InjectRepository(GithubWebhookDelivery) private readonly deliveriesRepo: Repository<GithubWebhookDelivery>,
    @InjectRepository(GithubStagingDeployment) private readonly stagingRepo: Repository<GithubStagingDeployment>,
    @InjectRepository(Release) private readonly releasesRepo: Repository<Release>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Project) private readonly projectsRepo: Repository<Project>,
    private readonly releaseLogs: ReleaseLogsService,
    private readonly audit: AuditLogService,
    private readonly api: GithubApiService,
    private readonly config: ConfigService,
  ) {}

  private secrets(): string[] {
    return [this.config.get<string>('GITHUB_WEBHOOK_SECRET'), this.config.get<string>('GITHUB_WEBHOOK_SECRET_NEXT')].filter((s): s is string => !!s && s.length > 0);
  }

  async settings(tenantId: number): Promise<{ enabled: boolean; taskKeyPrefix: string; updatedAt: Date | null }> {
    const row = await this.settingsRepo.findOne({ where: { tenantId } });
    return { enabled: !!row?.enabled, taskKeyPrefix: row?.taskKeyPrefix || GITHUB_DEFAULT_TASK_KEY_PREFIX, updatedAt: row?.updatedAt ?? null };
  }

  // Resolves once every delivery received so far has been processed (tests).
  settled(): Promise<void> {
    return this.queue;
  }

  // ---------- The webhook ----------

  async receive(rawBody: Buffer | undefined, headers: Record<string, any>, body: any): Promise<{ status: number; outcome: DeliveryOutcome; message: string }> {
    void this.prune();
    const header = (name: string) => {
      const v = headers[name];
      return typeof v === 'string' ? v.slice(0, 200) : null;
    };
    const event = header('x-github-event');
    const deliveryId = header('x-github-delivery');
    // A form-encoded delivery carries the JSON in "payload".
    let payload = body;
    if (payload && typeof payload.payload === 'string') {
      try {
        payload = JSON.parse(payload.payload);
      } catch {
        payload = {};
      }
    }
    const repo = typeof payload?.repository?.full_name === 'string' ? payload.repository.full_name.slice(0, 200) : null;
    const action = typeof payload?.action === 'string' ? payload.action.slice(0, 50) : null;
    const log = (row: Partial<GithubWebhookDelivery>) =>
      this.deliveriesRepo.save(this.deliveriesRepo.create({ deliveryId, event, action, repoFullName: repo, signatureValid: false, tenantId: null, ...row }));

    const secrets = this.secrets();
    if (secrets.length === 0) {
      await log({ outcome: 'refused', reason: 'The GitHub webhook secret is not set on the server.' });
      return { status: 503, outcome: 'refused', message: 'GitHub webhooks are not configured.' };
    }
    if (!signatureValid(rawBody, header('x-hub-signature-256') ?? undefined, secrets)) {
      await log({ outcome: 'refused', reason: 'Missing or invalid X-Hub-Signature-256.' });
      return { status: 401, outcome: 'refused', message: 'Invalid or missing signature.' };
    }
    if (!event) {
      await log({ signatureValid: true, outcome: 'refused', reason: 'Missing X-GitHub-Event.' });
      return { status: 400, outcome: 'refused', message: 'Missing X-GitHub-Event.' };
    }

    const mapping = repo ? await this.mappingsRepo.createQueryBuilder('m').where('lower(m.repoFullName) = lower(:repo)', { repo }).getOne() : null;
    const tenantId = mapping?.tenantId ?? null;
    if (deliveryId) {
      const earlier = await this.deliveriesRepo
        .createQueryBuilder('d')
        .where('d.deliveryId = :deliveryId AND d.signatureValid = true', { deliveryId })
        .andWhere("d.outcome NOT IN ('refused', 'duplicate')")
        .getOne();
      if (earlier) {
        await log({ tenantId, signatureValid: true, outcome: 'duplicate', reason: `Already received (delivery log #${earlier.id}).`, releaseId: earlier.releaseId });
        return { status: 200, outcome: 'duplicate', message: 'Already received.' };
      }
    }
    if (!mapping || !mapping.active) {
      const reason = event === 'ping' ? 'Ping from GitHub - the connection works.' : `Repository ${repo ?? '(none)'} is not ${mapping ? 'active' : 'mapped'} in Tracker.`;
      await log({ tenantId, signatureValid: true, outcome: 'ignored', reason });
      return { status: 202, outcome: 'ignored', message: reason };
    }
    if (!(await this.settings(mapping.tenantId)).enabled) {
      const reason = `GitHub releases are switched off - nothing recorded${event === 'ping' ? ' (ping: the connection works)' : ''}.`;
      await log({ tenantId, signatureValid: true, outcome: 'ignored', reason });
      return { status: 202, outcome: 'ignored', message: reason };
    }
    const result = classify(event, payload, mapping);
    if ('reason' in result) {
      await log({ tenantId, signatureValid: true, outcome: 'ignored', reason: result.reason });
      return { status: 202, outcome: 'ignored', message: result.reason };
    }
    const row = await log({ tenantId, signatureValid: true, outcome: 'received', environment: result.event.environment });
    const installationId = Number(payload?.installation?.id) || null;
    this.queue = this.queue
      .then(() => this.process(row, mapping, result.event, installationId))
      .catch((err) => this.logger.error(`GitHub delivery ${row.deliveryId}: ${err.message}`));
    return { status: 202, outcome: 'received', message: `${result.event.environment} ${result.event.version ?? ''}`.trim() };
  }

  private async prune() {
    try {
      await this.deliveriesRepo
        .createQueryBuilder()
        .delete()
        .where(`"receivedAt" < now() - make_interval(days => :days)`, { days: GITHUB_DELIVERY_RETENTION_DAYS })
        .execute();
    } catch (err: any) {
      this.logger.warn(`Pruning the delivery log failed: ${err.message}`);
    }
  }

  private async process(row: GithubWebhookDelivery, mapping: GithubRepoMapping, event: ClassifiedEvent, installationId: number | null): Promise<void> {
    let outcome: DeliveryOutcome = 'processed';
    let reason: string;
    let releaseId: number | null = null;
    try {
      const notes: string[] = [];
      if (!event.sha && event.ref && installationId && this.api.configured()) {
        try {
          event.sha = await this.api.commitSha(installationId, mapping.repoFullName, event.ref);
        } catch (err: any) {
          notes.push(`Could not look up the commit for ${event.ref}: ${err.message}`);
        }
      }
      if (event.environment === 'staging') {
        await this.stagingRepo.save(
          this.stagingRepo.create({ tenantId: mapping.tenantId, mappingId: mapping.id, sha: event.sha, version: event.version, deployedAt: event.at, deliveryId: row.deliveryId }),
        );
        reason = `Staging deployment recorded${event.version ? ` (${event.version})` : ''}.`;
      } else {
        const r = await this.recordProduction(row, mapping, event, installationId, notes);
        releaseId = r.releaseId;
        reason = r.summary;
      }
    } catch (err: any) {
      outcome = 'error';
      reason = `Could not process: ${err.message}`;
      this.logger.error(`GitHub delivery ${row.deliveryId}: ${err.stack || err.message}`);
    }
    await this.deliveriesRepo.update(row.id, { outcome, reason, releaseId, processedAt: new Date() });
  }

  private async timeZone(tenantId: number): Promise<string> {
    const rows = await this.releasesRepo.query(`SELECT "calendarTimeZone" FROM performance_tracking_settings WHERE "tenantId" = $1`, [tenantId]);
    return rows[0]?.calendarTimeZone || PERFORMANCE_TRACKING_DEFAULTS.calendarTimeZone;
  }

  private findBySha(mapping: GithubRepoMapping, sha: string): Promise<Release | null> {
    return this.releasesRepo
      .createQueryBuilder('r')
      .where('r.tenantId = :tenantId AND r.projectId = :projectId AND lower(r.appName) = lower(:appName)', mapping)
      .andWhere('lower(r.githubRepo) = lower(:repo) AND r.githubSha = :sha', { repo: mapping.repoFullName, sha })
      .getOne();
  }

  private async recordProduction(
    row: GithubWebhookDelivery,
    mapping: GithubRepoMapping,
    event: ClassifiedEvent,
    installationId: number | null,
    notes: string[],
  ): Promise<{ releaseId: number; summary: string }> {
    if (!event.version) throw new Error('No version - the event has neither a tag nor a commit.');
    const tenantId = mapping.tenantId;
    const project = await this.projectsRepo.findOne({ where: { id: mapping.projectId, tenantId } });
    if (!project) throw new Error(`Project #${mapping.projectId} no longer exists.`);
    const actorLabel = `GitHub (${mapping.repoFullName})`;
    const zone = await this.timeZone(tenantId);

    const find = async () =>
      (await this.releaseLogs.findByVersion(project.id, mapping.appName, event.version!, tenantId)) ?? (event.sha ? await this.findBySha(mapping, event.sha) : null);
    let release = await find();
    let created = false;
    if (!release) {
      try {
        release = await this.releasesRepo.save(
          this.releasesRepo.create({
            tenantId,
            projectId: project.id,
            projectName: project.name,
            appName: mapping.appName,
            version: event.version,
            releaseDate: dateInZone(event.at, zone),
            artifacts: event.link,
            source: 'github',
            createdByEmail: actorLabel,
            githubFilled: [],
            githubNotes: [],
          }),
        );
        created = true;
        await this.audit.record({
          userEmail: actorLabel,
          action: AuditActions.RELEASE_CREATED,
          tenantId,
          entityType: 'Release',
          entityId: release.id,
          details: { source: 'github', deliveryId: row.deliveryId, projectId: project.id, appName: mapping.appName, version: event.version, releaseDate: release.releaseDate },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        release = await find();
        if (!release) throw err;
      }
    }

    // Fill only what is empty - never overwrite what the PM entered.
    const previous = { ...release };
    const filled: string[] = [];
    if (!release.githubRepo) release.githubRepo = mapping.repoFullName;
    if (!release.githubSha && event.sha) release.githubSha = event.sha;
    if (!release.githubDeliveryId) release.githubDeliveryId = row.deliveryId;
    if (!release.githubReleasedByLogin && event.actorLogin) release.githubReleasedByLogin = event.actorLogin.slice(0, 100);
    if (release.releasedByUserId == null && event.actorLogin) {
      const user = await this.usersRepo
        .createQueryBuilder('u')
        .where('u.tenantId = :tenantId AND lower(u.githubLogin) = lower(:login)', { tenantId, login: event.actorLogin })
        .getOne();
      if (!user) notes.push(`Released by: GitHub user "${event.actorLogin}" isn't linked to a Tracker user (Admin -> Users -> GitHub username) - nobody is charged.`);
      else if (!RELEASED_BY_ROLES.includes(user.role)) notes.push(`Released by: ${user.fullName || user.email} (GitHub "${event.actorLogin}") isn't a Developer, Designer or DevOps account - not set.`);
      else if (release.stagingSignedOffByUserId === user.id) notes.push(`Released by: not set - ${user.fullName || user.email} signed off this release on staging and can't also be the one who released it.`);
      else {
        release.releasedByUserId = user.id;
        filled.push('releasedByUserId');
      }
    }
    if (!release.githubStagingDeployedOn) {
      const staged = await this.stagingFor(mapping, event);
      if (staged) {
        release.githubStagingDeployedOn = dateInZone(staged.deployedAt, zone);
        filled.push('githubStagingDeployedOn');
      } else if (release.stagingSignedOffOn == null) {
        notes.push('No staging deployment of this commit or version was seen before this release.');
      }
    }

    // Tasks named in the release's commits and pull requests.
    const texts = [...event.texts];
    if (this.api.configured() && installationId && event.sha) {
      try {
        const previousSha = await this.previousSha(mapping, release);
        const more = await this.api.releaseTexts(installationId, mapping.repoFullName, event.sha, previousSha);
        texts.push(...more.texts);
        notes.push(...more.notes);
      } catch (err: any) {
        notes.push(`Could not read the commits from GitHub (${err.message}) - only the event's own text was checked for tasks.`);
      }
    } else if (!this.api.configured()) {
      notes.push("The GitHub App's read access isn't set up on the server - only the event's own text was checked for tasks.");
    }
    const { taskKeyPrefix } = await this.settings(tenantId);
    let added = 0;
    for (const taskId of taskRefs(texts, taskKeyPrefix)) {
      const check = await this.releaseLogs.itemCheck(release, taskId, tenantId);
      if ('message' in check) {
        if (check.status !== 409) notes.push(`${taskKeyPrefix}-${taskId}: ${check.message}`);
        continue;
      }
      await this.releaseLogs.addItem(release.id, taskId, { id: null, email: actorLabel }, tenantId);
      added++;
    }
    if (added) filled.push('items');

    release.githubFilled = [...new Set([...(release.githubFilled || []), ...filled])];
    release.githubNotes = [...new Set([...(release.githubNotes || []), ...notes])].slice(-NOTES_MAX);
    release = await this.releasesRepo.save(release);
    if (!created && (filled.length || notes.length)) {
      await this.audit.record({
        userEmail: actorLabel,
        action: AuditActions.RELEASE_UPDATED,
        tenantId,
        entityType: 'Release',
        entityId: release.id,
        details: { source: 'github', deliveryId: row.deliveryId, filled, notes, previous: { releasedByUserId: previous.releasedByUserId, githubStagingDeployedOn: previous.githubStagingDeployedOn } },
      });
    }
    const skipped = notes.filter((n) => n.startsWith(`${taskKeyPrefix}-`)).length;
    const summary = `Production ${release.version}: ${created ? 'Release created' : 'existing Release filled in'}${filled.length ? ` (${filled.join(', ')})` : ''}; ${added} task(s) added${skipped ? `, ${skipped} skipped` : ''}.`;
    return { releaseId: release.id, summary };
  }

  // The latest staging deployment, before this release, of the same commit
  // or version (1.2.0-rc.1 counts for 1.2.0).
  private async stagingFor(mapping: GithubRepoMapping, event: ClassifiedEvent): Promise<GithubStagingDeployment | null> {
    const candidates = await this.stagingRepo
      .createQueryBuilder('s')
      .where('s.tenantId = :tenantId AND s.mappingId = :mappingId AND s.deployedAt <= :at', { tenantId: mapping.tenantId, mappingId: mapping.id, at: event.at })
      .orderBy('s.deployedAt', 'DESC')
      .limit(200)
      .getMany();
    const base = baseVersion(event.version);
    return (
      candidates.find(
        (s) => (event.sha && s.sha === event.sha) || (event.version && s.version === event.version) || (base && baseVersion(s.version) === base),
      ) ?? null
    );
  }

  // The commit of this app's previous GitHub release (for the commit range).
  private async previousSha(mapping: GithubRepoMapping, release: Release): Promise<string | null> {
    const prev = await this.releasesRepo
      .createQueryBuilder('r')
      .where('r.tenantId = :tenantId AND r.projectId = :projectId AND lower(r.appName) = lower(:appName)', mapping)
      .andWhere('lower(r.githubRepo) = lower(:repo) AND r.githubSha IS NOT NULL AND r.id <> :id', { repo: mapping.repoFullName, id: release.id })
      .andWhere('(r.releaseDate < :date OR (r.releaseDate = :date AND r.id < :id))', { date: release.releaseDate })
      .orderBy('r.releaseDate', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .getOne();
    return prev?.githubSha ?? null;
  }

  // ---------- Settings, mappings, delivery log (Admin, Program Manager) ----------

  async settingsPage(tenantId: number) {
    const [settings, mappings] = await Promise.all([
      this.settings(tenantId),
      this.mappingsRepo.find({ where: { tenantId }, order: { repoFullName: 'ASC' } }),
    ]);
    return {
      settings,
      mappings,
      server: { webhookSecret: this.secrets().length > 0, rotatingSecret: this.secrets().length > 1, appReadAccess: this.api.configured() },
      webhookPath: '/api/integrations/github/webhook',
      releaseKinds: RELEASE_KINDS,
    };
  }

  async saveSettings(dto: UpdateGithubSettingsDto, actor: Actor, tenantId: number) {
    const before = await this.settings(tenantId);
    const after = { enabled: dto.enabled ?? before.enabled, taskKeyPrefix: (dto.taskKeyPrefix ?? before.taskKeyPrefix).trim().toUpperCase() };
    if (!TASK_KEY_PREFIX.test(after.taskKeyPrefix)) throw new BadRequestException('The task key prefix must be 2-10 letters or digits, starting with a letter (e.g. TRK).');
    const row = (await this.settingsRepo.findOne({ where: { tenantId } })) ?? this.settingsRepo.create({ tenantId });
    Object.assign(row, after, { updatedByUserId: actor.id });
    await this.settingsRepo.save(row);
    await this.audit.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: GITHUB_AUDIT.SETTINGS_UPDATED,
      tenantId,
      entityType: 'GithubSettings',
      entityId: tenantId,
      details: { before: { enabled: before.enabled, taskKeyPrefix: before.taskKeyPrefix }, after },
    });
    return this.settingsPage(tenantId);
  }

  private async mappingFields(dto: RepoMappingDto, tenantId: number, current?: GithubRepoMapping) {
    const out: Partial<GithubRepoMapping> = {};
    if (dto.repoFullName !== undefined) {
      const repo = dto.repoFullName.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
      if (!REPO_FULL_NAME.test(repo)) throw new BadRequestException('Repository must be owner/name, e.g. vistoria/tracker.');
      out.repoFullName = repo;
    }
    if (dto.projectId !== undefined) {
      const project = await this.projectsRepo.findOne({ where: { id: dto.projectId, tenantId } });
      if (!project) throw new NotFoundException(`Project #${dto.projectId} not found`);
      out.projectId = project.id;
    }
    if (dto.appName !== undefined) {
      const app = dto.appName.trim();
      if (!app || app.length > 255) throw new BadRequestException('App name is required (up to 255 characters).');
      out.appName = app;
    }
    if (dto.active !== undefined) out.active = dto.active;
    const lists: Array<[keyof RepoMappingDto & keyof GithubRepoMapping, string]> = [
      ['stagingEnvironments', 'Staging environments'],
      ['productionEnvironments', 'Production environments'],
      ['deployWorkflows', 'Deploy workflows'],
      ['stagingBranches', 'Staging branches'],
      ['productionBranches', 'Production branches'],
    ];
    for (const [key, label] of lists) {
      if (dto[key] === undefined) continue;
      const r = cleanList(dto[key], label);
      if ('problem' in r) throw new BadRequestException(r.problem);
      (out as any)[key] = r.value;
    }
    for (const key of ['publishedReleaseIs', 'preReleaseIs'] as const) {
      if (dto[key] === undefined) continue;
      if (!RELEASE_KINDS.includes(dto[key] as any)) throw new BadRequestException(`${key} must be production, staging or ignore.`);
      out[key] = dto[key] as any;
    }
    const merged = { ...current, ...out } as GithubRepoMapping;
    const problem =
      overlapProblem(merged.stagingEnvironments ?? ['staging'], merged.productionEnvironments ?? ['production'], 'Environments') ||
      overlapProblem(merged.stagingBranches ?? [], merged.productionBranches ?? [], 'Branches');
    if (problem) throw new BadRequestException(problem);
    return out;
  }

  async createMapping(dto: RepoMappingDto, actor: Actor, tenantId: number) {
    if (!dto.repoFullName || dto.projectId === undefined || !dto.appName) throw new BadRequestException('Repository, project and app name are required.');
    const fields = await this.mappingFields(dto, tenantId);
    let saved: GithubRepoMapping;
    try {
      saved = await this.mappingsRepo.save(this.mappingsRepo.create({ ...fields, tenantId, createdByUserId: actor.id }));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`${fields.repoFullName} is already mapped.`);
      throw err;
    }
    await this.audit.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: GITHUB_AUDIT.MAPPING_CREATED,
      tenantId,
      entityType: 'GithubRepoMapping',
      entityId: saved.id,
      details: { after: saved },
    });
    return saved;
  }

  async updateMapping(id: number, dto: RepoMappingDto, actor: Actor, tenantId: number) {
    const mapping = await this.mappingsRepo.findOne({ where: { id, tenantId } });
    if (!mapping) throw new NotFoundException(`Mapping #${id} not found`);
    const before = { ...mapping };
    Object.assign(mapping, await this.mappingFields(dto, tenantId, mapping));
    let saved: GithubRepoMapping;
    try {
      saved = await this.mappingsRepo.save(mapping);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`${mapping.repoFullName} is already mapped.`);
      throw err;
    }
    await this.audit.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: GITHUB_AUDIT.MAPPING_UPDATED,
      tenantId,
      entityType: 'GithubRepoMapping',
      entityId: saved.id,
      details: { before, after: saved },
    });
    return saved;
  }

  // The newest deliveries for this tenant. Deliveries that matched no
  // mapped repository (or were refused) have no tenant - Admins see those.
  deliveries(tenantId: number, includeUnmatched: boolean, limit = 100) {
    const q = this.deliveriesRepo.createQueryBuilder('d').where('d.tenantId = :tenantId', { tenantId });
    if (includeUnmatched) q.orWhere('d.tenantId IS NULL');
    return q.orderBy('d.receivedAt', 'DESC').addOrderBy('d.id', 'DESC').limit(Math.min(Math.max(limit, 1), 500)).getMany();
  }
}
