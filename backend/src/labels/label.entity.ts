import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Admin/PM-managed lookup table for free-form issue labels/tags, separate
// from the existing category/priority enums. Standalone for now, not yet
// wired to Issue as a real FK/join table (deliberate, see plan).
@Entity('labels')
export class Label {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
