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

  @Column({ nullable: true })
  createdByUserId: number;

  @Column({ nullable: true })
  createdByEmail: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
