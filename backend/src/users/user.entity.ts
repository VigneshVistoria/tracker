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
  USER = 'user',
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

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  // The projects this user is allowed to see/work in.
  @ManyToMany(() => Project)
  @JoinTable({ name: 'user_projects' })
  projects: Project[];

  @CreateDateColumn()
  createdAt: Date;
}
