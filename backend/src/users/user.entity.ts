import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToMany,
  JoinTable,
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
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;

  // NEVER store plain-text passwords. This column holds a bcrypt hash only.
  @Column()
  passwordHash: string;

  @Column({ nullable: true })
  fullName: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.DEVELOPER })
  role: UserRole;

  // The projects this user is allowed to see/work in.
  @ManyToMany(() => Project)
  @JoinTable({ name: 'user_projects' })
  projects: Project[];

  @CreateDateColumn()
  createdAt: Date;
}
