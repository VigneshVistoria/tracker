import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToMany,
  JoinTable,
  Unique,
} from 'typeorm';
import { Project } from '../projects/project.entity';

export enum UserRole {
  ADMIN = 'admin',
  DEVELOPER = 'developer',
  QA = 'qa',
  EXECUTIVE = 'executive',
  // Added for ReleaseBot: previously this was just a singleton
  // `isProgramManager` flag any one user could hold rather than a real
  // role. Promoted to a normal role (2026-08-22, per Vignesh) so more than
  // one person can hold it and it behaves like every other role for
  // authorization purposes (ticket creation, approvals, etc.).
  PROGRAM_MANAGER = 'program_manager',
  // External user submitting UAT feedback / post-go-live support
  // requests. Can file tickets and see only the ones they created -
  // never the internal ticket list, assignees, or any other client's
  // tickets.
  CLIENT = 'client',
}

// Multi-tenant conversion Phase B: email is unique within a tenant, not
// globally - two different tenants may have users with the same email.
// See the migration that ships alongside this for the constraint swap
// (drops the old global UNIQUE(email), adds this composite one).
@Entity('users')
@Unique(['tenantId', 'email'])
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - set explicitly during auth (Phase
  // B) via UsersService.create()/adminCreate(); everything else still
  // reads it via the column default until Phase C wires up query scoping.
  @Column({ nullable: true })
  tenantId: number;

  @Column()
  email: string;

  // NEVER store plain-text passwords. This column holds a bcrypt hash only.
  @Column()
  passwordHash: string;

  @Column({ nullable: true })
  fullName: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.DEVELOPER })
  role: UserRole;

  // Multi-tenant conversion Phase E - platform-wide staff power (can
  // create new tenants), orthogonal to `role` above (a tenant's own
  // admin). Never set via any user-facing form; granted manually.
  @Column({ default: false })
  isPlatformSuperadmin: boolean;

  // The projects this user is allowed to see/work in.
  @ManyToMany(() => Project)
  @JoinTable({ name: 'user_projects' })
  projects: Project[];

  @CreateDateColumn()
  createdAt: Date;
}
