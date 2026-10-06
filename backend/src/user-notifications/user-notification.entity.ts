import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// In-app notification for exactly one recipient (see
// migrations/2026-10-user-notifications.sql). Separate from the email/
// Teams notifications in src/notifications - those stay unchanged.
@Entity('user_notifications')
export class UserNotification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  // Recipient. Every read path filters on this = the caller's own id.
  @Column()
  userId: number;

  // e.g. 'task.assigned', 'task.reviewRejected' - lets the UI pick an icon.
  @Column({ length: 64 })
  type: string;

  @Column({ length: 300 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  // In-app path to open, e.g. /tasks/42.
  @Column({ type: 'varchar', length: 300, nullable: true })
  link: string | null;

  @Column({ type: 'int', nullable: true })
  actorUserId: number | null;

  @Column({ type: 'varchar', nullable: true })
  actorName: string | null;

  @Column({ type: 'timestamp', nullable: true })
  readAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
