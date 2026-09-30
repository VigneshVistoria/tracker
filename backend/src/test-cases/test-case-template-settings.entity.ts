import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// Singleton row per tenant: the Admin/PM-chosen column order for the
// bulk import template and export. columnOrder holds column keys -
// built-in columns by name (see BUILT_IN_COLUMNS) and custom fields as
// 'cf:<id>' (by id, so renaming a field keeps its place). Keys that no
// longer resolve (a deleted/deactivated field) are skipped, and columns
// missing from the list are appended - see
// TestCaseTemplateSettingsService.orderedColumns().
@Entity('test_case_template_settings')
export class TestCaseTemplateSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  columnOrder: string[];

  @UpdateDateColumn()
  updatedAt: Date;
}
