import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { TasksService } from '../tasks/tasks.service';
import { AuditLogService } from '../audit/audit-log.service';
import { UserRole } from '../users/user.entity';
import { LIST_ITEM_MAX, LIST_MAX_COUNT } from '../tasks/defect-triage';
import {
  CHECKLIST_ITEMS,
  ChecklistItem,
  StoredSubmissionChecklist,
  SUBMISSION_CHECKLIST_AUDIT,
  SubmissionChecklistInput,
  SubmissionChecklistSettings,
  evaluateChecklist,
  resolveSubmissionChecklistSettings,
} from '../tasks/submission-checklist';
import { SaveSubmissionChecklistSettingsDto } from './dto/submission-checklist-settings.dto';

type Actor = { id: number; email: string; role: UserRole };

// Admin and Program Manager edit the settings and switch projects - the
// same pair as Defect Triage Settings.
export const SUBMISSION_CHECKLIST_SETTINGS_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

// See tasks/submission-checklist.ts for the rules.
@Injectable()
export class SubmissionChecklistService {
  constructor(
    @InjectRepository(Project)
    private projectsRepository: Repository<Project>,
    @InjectRepository(TeamSettings)
    private teamSettingsRepository: Repository<TeamSettings>,
    private tasksService: TasksService,
    private auditLogService: AuditLogService,
  ) {}

  async settings(tenantId: number): Promise<SubmissionChecklistSettings> {
    const row = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    return resolveSubmissionChecklistSettings(row?.submissionChecklistSettings);
  }

  async isOn(projectId: number, tenantId: number): Promise<boolean> {
    const project = await this.projectsRepository.findOne({ where: { id: projectId, tenantId }, select: ['id', 'submissionChecklistEnabled'] });
    return !!project?.submissionChecklistEnabled;
  }

  // Called by TaskQaReviewsService.submit(): null when the project has it
  // off; otherwise the checklist to store, or a 400 naming what's missing.
  async check(task: ProjectTask, input: SubmissionChecklistInput | undefined, artifactTypes: string[]): Promise<StoredSubmissionChecklist | null> {
    if (!(await this.isOn(task.projectId, task.tenantId))) return null;
    const [settings, triage] = await Promise.all([this.settings(task.tenantId), this.tasksService.defectTriageSettings(task.tenantId)]);
    const { missing, stored } = evaluateChecklist(input, { isDefect: task.isDefect, artifactTypes, settings, environments: triage.environments });
    if (missing.length > 0) {
      throw new BadRequestException(`The submission checklist is not complete. Missing: ${missing.join('; ')}.`);
    }
    return stored;
  }

  // What the submit form needs: the switch for every project, the lists
  // and rules, and the environments (Stage 1 list).
  async options(tenantId: number) {
    const [settings, triage, on] = await Promise.all([
      this.settings(tenantId),
      this.tasksService.defectTriageSettings(tenantId),
      this.projectsRepository.find({ where: { tenantId, submissionChecklistEnabled: true }, select: ['id'] }),
    ]);
    return { enabledProjectIds: on.map((p) => p.id), ...settings, environments: triage.environments };
  }

  async settingsPage(tenantId: number) {
    const projects = await this.projectsRepository.find({ where: { tenantId }, order: { name: 'ASC' } });
    return {
      settings: await this.settings(tenantId),
      projects: projects.map((p) => ({ id: p.id, name: p.name, submissionChecklistEnabled: !!p.submissionChecklistEnabled })),
    };
  }

  async saveSettings(dto: SaveSubmissionChecklistSettingsDto, actor: Actor, tenantId: number): Promise<SubmissionChecklistSettings> {
    const causes: SubmissionChecklistSettings['rootCauses'] = [];
    for (const c of dto.rootCauses) {
      const label = (c.label || '').trim();
      if (label && label.length <= LIST_ITEM_MAX && !causes.some((x) => x.label.toLowerCase() === label.toLowerCase())) {
        causes.push({ label, needsNote: !!c.needsNote });
      }
    }
    if (causes.length === 0) throw new BadRequestException('Keep at least one root cause.');
    if (causes.length > LIST_MAX_COUNT) throw new BadRequestException(`No more than ${LIST_MAX_COUNT} root causes.`);
    const unique = (v: string[]) => [...new Set(v)];
    const items = (v: string[]) => CHECKLIST_ITEMS.filter((i) => v.includes(i)) as ChecklistItem[];
    const next: SubmissionChecklistSettings = {
      rootCauses: causes,
      linkArtifactTypes: unique(dto.linkArtifactTypes),
      evidenceArtifactTypes: unique(dto.evidenceArtifactTypes),
      required: { defect: items(dto.required.defect), task: items(dto.required.task).filter((i) => i !== 'rootCause') },
      minTextLength: dto.minTextLength,
    };
    if (next.linkArtifactTypes.length === 0) throw new BadRequestException('Pick at least one artifact type that counts as the change link.');
    if (next.evidenceArtifactTypes.length === 0) throw new BadRequestException('Pick at least one artifact type that counts as self-test evidence.');
    const before = await this.settings(tenantId);
    const existing = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    if (existing) {
      await this.teamSettingsRepository.update({ tenantId }, { submissionChecklistSettings: next as any, updatedByUserId: actor.id });
    } else {
      await this.teamSettingsRepository.save(this.teamSettingsRepository.create({ tenantId, submissionChecklistSettings: next as any, updatedByUserId: actor.id }));
    }
    await this.auditLogService.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: SUBMISSION_CHECKLIST_AUDIT.SETTINGS_UPDATED,
      tenantId,
      entityType: 'TeamSettings',
      entityId: tenantId,
      details: { before, after: next },
    });
    return resolveSubmissionChecklistSettings(next);
  }

  // Applies from the next submission on - rounds already submitted are
  // never re-checked.
  async setProjectSwitch(projectId: number, enabled: boolean, actor: Actor, tenantId: number) {
    const project = await this.projectsRepository.findOne({ where: { id: projectId, tenantId } });
    if (!project) throw new NotFoundException(`Project #${projectId} not found`);
    await this.projectsRepository.update({ id: projectId, tenantId }, { submissionChecklistEnabled: enabled });
    await this.auditLogService.record({
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: SUBMISSION_CHECKLIST_AUDIT.PROJECT_SWITCHED,
      tenantId,
      entityType: 'Project',
      entityId: projectId,
      details: { from: !!project.submissionChecklistEnabled, to: enabled },
    });
    return { projectId, submissionChecklistEnabled: enabled };
  }
}
