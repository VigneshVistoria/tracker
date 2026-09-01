import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Admin/PM-managed lookup table for issue categories. Named
// IssueCategoryOption (not IssueCategory) to avoid clashing with the
// existing hardcoded IssueCategory enum still used by Issue.category -
// this table is a standalone, admin-editable catalog for now and is not
// yet wired to Issue.category as a real FK (deliberate, see plan).
@Entity('issue_categories')
export class IssueCategoryOption {
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
