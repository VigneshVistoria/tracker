import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { DeliveryOutcome, Environment, ReleaseKind } from './github-releases';

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
