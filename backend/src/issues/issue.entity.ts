import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum IssueStatus {
  OPEN = 'Open',
  IN_PROGRESS = 'In Progress',
  CLIENT_REVIEW = 'Client Review',
  CLOSED = 'Closed',
}

export enum IssueMode {
  AUTO = 'Auto',
  MANUAL = 'Manual',
}

@Entity('issues')
export class Issue {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: IssueStatus,
    default: IssueStatus.OPEN,
  })
  status: IssueStatus;

  // id of the user who created the issue - null for issues auto-created
  // by an integration (e.g. Microsoft Teams) rather than a logged-in person.
  @Column({ nullable: true })
  createdByUserId: number;

  @Column({ nullable: true })
  createdByEmail: string;

  // The user responsible for resolving this issue (nullable = unassigned).
  @Column({ nullable: true })
  assigneeUserId: number;

  @Column({ nullable: true })
  assigneeEmail: string;

  // Which project this issue belongs to (nullable = no project set).
  @Column({ nullable: true })
  projectId: number;

  @Column({ nullable: true })
  projectName: string;

  // How the issue was raised - most will be "Manual" (someone filed it);
  // "Auto" is reserved for issues a system/integration files automatically.
  @Column({ type: 'enum', enum: IssueMode, default: IssueMode.MANUAL })
  mode: IssueMode;

  // Marks a critical, blocking issue for quick triage/filtering.
  @Column({ type: 'boolean', default: false })
  showstopper: boolean;

  // Set automatically the moment status becomes "Closed", cleared if
  // it's reopened - never set directly by the user.
  @Column({ type: 'timestamp', nullable: true })
  closedOn: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
