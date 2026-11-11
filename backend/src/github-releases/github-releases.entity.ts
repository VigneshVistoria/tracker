import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { DeliveryOutcome, Environment, ReleaseKind, ReleaseStage } from './github-releases';

// Performance Tracking P1/P2 from GitHub (migrations/2026-11-github-
// releases.sql) - see ./github-releases.ts.

// One row per tenant: the switch (OFF) and the task key prefix. No row =
// the defaults.
@Entity('github_settings')
export class GithubSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: 'varchar', length: 10, default: 'TRK' })
  taskKeyPrefix: string;

  // PR helpers (migrations/2026-11-github-pr-helpers.sql): own switch,
  // independent of "enabled" (releases).
  @Column({ default: false })
  prHelpersEnabled: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  prHelperProjectIds: number[];

  @Column({ type: 'varchar', length: 30, default: 'feature/' })
  branchPrefix: string;

  // Multi-stage release path (migrations/2026-11-github-release-stages.sql).
  @Column({ default: false })
  releaseStagesEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  updatedByUserId: number | null;

  @UpdateDateColumn()
  updatedAt: Date;
}

// A repository -> Tracker project + app name, and what is staging or
// production for it. A repository maps to one project (unique, any case).
@Entity('github_repo_mappings')
export class GithubRepoMapping {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ type: 'varchar', length: 200 })
  repoFullName: string;

  @Column()
  projectId: number;

  @Column({ type: 'varchar', length: 255 })
  appName: string;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'jsonb', default: () => `'["staging"]'` })
  stagingEnvironments: string[];

  @Column({ type: 'jsonb', default: () => `'["production"]'` })
  productionEnvironments: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  deployWorkflows: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  stagingBranches: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  productionBranches: string[];

  @Column({ type: 'varchar', length: 10, default: 'production' })
  publishedReleaseIs: ReleaseKind;

  @Column({ type: 'varchar', length: 10, default: 'staging' })
  preReleaseIs: ReleaseKind;

  // Ordered stages (empty = Staging/Production as above) and the P1
  // sign-off stage (NULL = default: Test, else the stage before Production).
  @Column({ type: 'jsonb', default: () => `'[]'` })
  stages: ReleaseStage[];

  @Column({ type: 'varchar', length: 40, nullable: true })
  p1StageKey: string | null;

  @Column()
  createdByUserId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// Every webhook delivery, signed or not - a summary, never the payload.
// tenantId is null when it matched no mapped repository.
@Entity('github_webhook_deliveries')
export class GithubWebhookDelivery {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true })
  tenantId: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  deliveryId: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  event: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  action: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  repoFullName: string | null;

  @Column()
  signatureValid: boolean;

  @Column({ type: 'varchar', length: 12 })
  outcome: DeliveryOutcome;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  environment: Environment | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  stageName: string | null;

  @Column({ type: 'int', nullable: true })
  releaseId: number | null;

  @CreateDateColumn()
  receivedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date | null;
}

// A staging deployment GitHub reported - its date is suggested on the
// production release of the same commit or version.
@Entity('github_staging_deployments')
export class GithubStagingDeployment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  mappingId: number;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sha: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  version: string | null;

  @Column({ type: 'timestamp' })
  deployedAt: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  deliveryId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

// One deploy to one stage of a repository with stages.
@Entity('github_stage_deployments')
export class GithubStageDeployment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  mappingId: number;

  @Column({ type: 'varchar', length: 40 })
  stageKey: string;

  @Column({ type: 'varchar', length: 60 })
  stageName: string;

  @Column({ default: false })
  isProduction: boolean;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sha: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  version: string | null;

  @Column({ type: 'timestamp' })
  deployedAt: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  deliveryId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

// When a task first (and last) reached a stage - any task named in a
// deploy, with or without a Resolution.
@Entity('task_stage_progress')
export class TaskStageProgress {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  @Column()
  mappingId: number;

  @Column({ type: 'varchar', length: 40 })
  stageKey: string;

  @Column({ type: 'varchar', length: 60 })
  stageName: string;

  @Column({ type: 'timestamp' })
  firstReachedAt: Date;

  @Column({ type: 'timestamp' })
  lastReachedAt: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  firstVersion: string | null;

  @Column({ type: 'int', nullable: true })
  firstDeploymentId: number | null;
}
