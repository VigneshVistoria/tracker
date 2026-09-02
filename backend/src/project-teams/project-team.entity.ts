import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// A Team belongs to exactly one Project - two Projects can each have their
// own "Backend" team, but the same Project can't have two. Deliberately
// distinct from the standalone `teams` catalog (backend/src/teams) - that
// one is a tenant-wide lookup table not scoped to any Project and (per its
// own comments) not actually wired to anything yet. This entity is the
// real per-Project Team that Project Planning's Team field and future
// Team-scoped features resolve against. No hard delete - Inactive just
// hides a Team from "assign to a new entry" pickers going forward
// (findAllForProject's default) without breaking Project Planning entries
// or Tasks that already reference it, same convention as Module/Phase.
export const PROJECT_TEAM_STATUSES = ['Active', 'Inactive'] as const;
export type ProjectTeamStatus = (typeof PROJECT_TEAM_STATUSES)[number];

@Entity('project_teams')
export class ProjectTeam {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column()
  projectName: string;

  @Column()
  name: string;

  @Column({ default: 'Active' })
  status: ProjectTeamStatus;

  @Column({ nullable: true })
  createdByUserId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
