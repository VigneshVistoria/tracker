import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { HandoverKind, HandoverStatus } from './task-handovers';
import { DesignHandoverArtifact } from './design-handovers';

// C4 (migrations/2026-11-performance-tracking-handovers.sql) - a task
// handed from one person to the next owner, with the template. See
// ./task-handovers.ts.
@Entity('task_handovers')
export class TaskHandover {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  taskId: number;

  @Column()
  projectId: number;

  // The assignee handing over (charged in C4), and who pressed the button.
  @Column()
  fromUserId: number;

  @Column()
  startedByUserId: number;

  @Column()
  toUserId: number;

  @Column({ type: 'text' })
  whatDone: string;

  @Column({ type: 'text' })
  howToTest: string;

  @Column({ type: 'text' })
  knownIssues: string;

  @Column({ type: 'text' })
  dependencies: string;

  @Column({ type: 'text' })
  environment: string;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: HandoverStatus;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  decidedByUserId: number | null;

  @Column({ type: 'text', nullable: true })
  rejectReason: string | null;

  // Design handover (2026-11-12, migrations/2026-11-design-handover.sql):
  // 'owner' = the C4 handover above; 'design' = a designer hands a design
  // task to development (./design-handovers.ts). For 'design' the notes
  // are in whatDone, the other template fields are empty.
  @Column({ type: 'varchar', length: 10, default: 'owner' })
  kind: HandoverKind;

  @Column({ type: 'jsonb', nullable: true })
  artifacts: DesignHandoverArtifact[] | null;

  @Column({ type: 'int', nullable: true })
  linkedTaskId: number | null;
}
