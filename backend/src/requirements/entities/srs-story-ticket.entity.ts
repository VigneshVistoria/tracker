import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { TicketKind } from '../requirements';

// A Tracker ticket (project_tasks) linked to a story as Dev or QA work. The
// same ticket can be both. Linking never writes to the ticket itself.
@Entity('srs_story_tickets')
export class SrsStoryTicket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  storyId: number;

  @Column()
  taskId: number;

  @Column({ type: 'varchar', length: 5 })
  kind: TicketKind;

  @Column()
  linkedByUserId: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  linkedAt: Date;
}
