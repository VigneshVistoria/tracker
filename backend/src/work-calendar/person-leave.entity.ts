import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

// B4 - leave entered by hand, whole days; kept after removal.
@Entity('person_leave')
export class PersonLeave {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  userId: number;

  @Column({ type: 'date' })
  startDate: string;

  @Column({ type: 'date' })
  endDate: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column()
  createdByUserId: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'int', nullable: true })
  removedByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  removedAt: Date | null;
}
