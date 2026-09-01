import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Admin/PM-managed lookup table for teams (groups of users). Unrelated to
// the Microsoft Teams webhook integration (backend/src/teams-integration,
// TeamsSubscription entity, table teams_subscriptions) - different
// folder, different entity/table, different routes (/teams here vs
// /integrations/teams/* there). Standalone for now, not yet wired to
// User/Issue as a real FK (deliberate, see plan).
@Entity('teams')
export class Team {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
