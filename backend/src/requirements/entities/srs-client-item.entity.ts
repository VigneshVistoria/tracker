import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// An open client item on an SRS (things to confirm with the client). While
// it is open, the stories linked to it (srs_client_item_stories) show as
// Blocked. BA/PM/Admin create; PM/Admin close with a resolution. Numbers
// are never reused.
@Entity('srs_client_items')
export class SrsClientItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  srsId: number;

  @Column({ type: 'int' })
  number: number;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text', nullable: true })
  baseline: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  owner: string | null;

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status: 'open' | 'closed';

  @Column({ type: 'text', nullable: true })
  resolution: string | null;

  @Column({ type: 'int', nullable: true })
  closedByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  createdByUserId: number | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'now()' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  deletedByUserId: number | null;
}
