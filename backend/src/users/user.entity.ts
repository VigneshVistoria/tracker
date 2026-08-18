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

  // Exactly one person at a time can hold this - not a role, just a flag
  // marking who currently has authority to approve/reject issues
  // submitted for review. Enforced as a singleton in UsersService.
  @Column({ type: 'boolean', default: false })
  isProgramManager: boolean;

  // The projects this user is allowed to see/work in.
  @ManyToMany(() => Project)
  @JoinTable({ name: 'user_projects' })
  projects: Project[];

  @CreateDateColumn()
  createdAt: Date;
}
