import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum CustomFieldType {
  TEXT = 'Text',
  NUMBER = 'Number',
  DATE = 'Date',
  DROPDOWN = 'Dropdown',
}

// Admin/Program Manager-defined extra field on test cases (e.g. "Browser",
// "Environment", "Test Type"). Values live on the test case itself in
// TestCase.customFields, keyed by this row's id - see that column's
// comment. `name` doubles as the column header bulk import matches on
// (TestCasesService.bulkImport()), so it's unique per tenant
// (case-insensitive) and can't collide with a built-in column.
//
// fieldType is fixed once created (TestCaseCustomFieldsService.update()
// never changes it) - flipping e.g. Text -> Number would silently
// invalidate every value already saved under it. No hard delete once any
// test case has a value for it; deactivate instead, same reasoning as
// TestCaseStatus.DEPRECATED.
@Entity('test_case_custom_fields')
export class TestCaseCustomField {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: CustomFieldType })
  fieldType: CustomFieldType;

  // Dropdown choices, in display order. Always [] for other types.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  options: string[];

  @Column({ default: false })
  isRequired: boolean;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
