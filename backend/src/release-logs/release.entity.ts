import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// One release of an app (Project + App Name + Version + Release Date),
// with a single free-text Artifacts field covering the whole release
// (build links, store listings, etc.) rather than per-ticket artifacts.
// Named `releases` so it can later become ReleaseBot's planned
// first-class Release entity (see Dependency.releaseId) - the approval
// gate and generated release notes aren't built yet.
@Entity('releases')
export class Release {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column()
  projectName: string;

  @Column()
  appName: string;

  @Column()
  version: string;

  @Column({ type: 'date' })
  releaseDate: string;

  @Column({ type: 'text', nullable: true })
  artifacts: string;

  // Performance Tracking P1/P2 (migrations/2026-11-performance-tracking-
  // release-path.sql), entered by the PM - see release-path.ts.
  @Column({ type: 'int', nullable: true })
  releasedByUserId: number | null;

  @Column({ type: 'date', nullable: true })
  stagingSignedOffOn: string | null;

  @Column({ type: 'int', nullable: true })
  stagingSignedOffByUserId: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  changeTicketRef: string | null;

  @Column({ nullable: true })
  createdByUserId: number;

  @Column({ nullable: true })
  createdByEmail: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
