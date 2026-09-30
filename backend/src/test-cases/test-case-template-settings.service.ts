import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestCaseTemplateSettings } from './test-case-template-settings.entity';
import { TestCaseCustomField } from './test-case-custom-field.entity';
import { TestCaseCustomFieldsService } from './test-case-custom-fields.service';
import { BUILT_IN_COLUMNS, REQUIRED_COLUMNS, BuiltInColumn } from './test-case-columns';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

// One template/export column: a built-in (key = its name) or an active
// custom field (key = 'cf:<id>'). header is what the spreadsheet shows
// and what bulkImport() matches on.
export interface TemplateColumn {
  key: string;
  header: string;
  isCustom: boolean;
  isRequired: boolean;
  field?: TestCaseCustomField;
}

const customKey = (field: TestCaseCustomField) => `cf:${field.id}`;

@Injectable()
export class TestCaseTemplateSettingsService {
  constructor(
    @InjectRepository(TestCaseTemplateSettings)
    private settingsRepository: Repository<TestCaseTemplateSettings>,
    private customFieldsService: TestCaseCustomFieldsService,
    private auditLogService: AuditLogService,
  ) {}

  private async findRow(tenantId: number): Promise<TestCaseTemplateSettings | null> {
    const rows = await this.settingsRepository.find({ where: { tenantId }, take: 1 });
    return rows[0] || null;
  }

  // Built-ins plus active custom fields, in the tenant's saved order.
  // Saved keys that no longer resolve are skipped; anything not in the
  // saved list (e.g. a field added since) keeps its default relative
  // position at the end - built-ins first, then fields by sortOrder.
  async orderedColumns(tenantId: number, fields?: TestCaseCustomField[]): Promise<TemplateColumn[]> {
    const [allFields, row] = await Promise.all([
      fields ? Promise.resolve(fields) : this.customFieldsService.findAll(tenantId),
      this.findRow(tenantId),
    ]);
    const defaults: TemplateColumn[] = [
      ...BUILT_IN_COLUMNS.map((name) => ({
        key: name,
        header: name,
        isCustom: false,
        isRequired: REQUIRED_COLUMNS.includes(name as BuiltInColumn),
      })),
      ...allFields
        .filter((f) => f.isActive)
        .map((f) => ({ key: customKey(f), header: f.name, isCustom: true, isRequired: f.isRequired, field: f })),
    ];
    const byKey = new Map(defaults.map((c) => [c.key, c]));
    const ordered: TemplateColumn[] = [];
    for (const key of row?.columnOrder || []) {
      const column = byKey.get(key);
      if (column) {
        ordered.push(column);
        byKey.delete(key);
      }
    }
    return [...ordered, ...defaults.filter((c) => byKey.has(c.key))];
  }

  async getColumnOrder(tenantId: number) {
    const [columns, row] = await Promise.all([this.orderedColumns(tenantId), this.findRow(tenantId)]);
    return {
      columns: columns.map(({ field, ...column }) => column),
      isCustomized: (row?.columnOrder || []).length > 0,
    };
  }

  // An empty list resets to the default order. Otherwise every key must
  // be a built-in column or one of this tenant's custom fields (inactive
  // ones allowed, so their spot is kept if reactivated), with no repeats.
  async updateColumnOrder(columnOrder: string[], user: { id: number; email: string }, tenantId: number) {
    const fields = await this.customFieldsService.findAll(tenantId);
    const validKeys = new Set<string>([...BUILT_IN_COLUMNS, ...fields.map(customKey)]);
    const seen = new Set<string>();
    for (const key of columnOrder) {
      if (!validKeys.has(key)) {
        throw new BadRequestException(`Unknown column "${key}".`);
      }
      if (seen.has(key)) {
        throw new BadRequestException(`Column "${key}" is listed more than once.`);
      }
      seen.add(key);
    }

    const row = (await this.findRow(tenantId)) || this.settingsRepository.create({ tenantId, columnOrder: [] });
    const previous = row.columnOrder;
    row.columnOrder = columnOrder;
    await this.settingsRepository.save(row);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TEST_CASE_TEMPLATE_COLUMN_ORDER_UPDATED,
      tenantId,
      entityType: 'TestCaseTemplateSettings',
      entityId: row.id,
      details: { previous, updated: columnOrder },
    });
    return this.getColumnOrder(tenantId);
  }
}
