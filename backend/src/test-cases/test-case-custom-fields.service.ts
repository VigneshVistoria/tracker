import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestCaseCustomField, CustomFieldType } from './test-case-custom-field.entity';
import { TestCase } from './test-case.entity';
import { CreateTestCaseCustomFieldDto } from './dto/create-test-case-custom-field.dto';
import { UpdateTestCaseCustomFieldDto } from './dto/update-test-case-custom-field.dto';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { isReservedFieldName, normalizeHeader } from './test-case-columns';

export type CustomFieldValues = Record<string, string | number>;

// Plain shape (not a discriminated union) - this project compiles without
// strictNullChecks, so union narrowing on `ok` doesn't work.
type CoerceResult = { ok: boolean; value?: string | number; message?: string };

const MAX_TEXT_LENGTH = 5000;
const MAX_OPTION_LENGTH = 100;

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

@Injectable()
export class TestCaseCustomFieldsService {
  constructor(
    @InjectRepository(TestCaseCustomField)
    private fieldsRepository: Repository<TestCaseCustomField>,
    @InjectRepository(TestCase)
    private testCasesRepository: Repository<TestCase>,
    private auditLogService: AuditLogService,
  ) {}

  findAll(tenantId: number): Promise<TestCaseCustomField[]> {
    return this.fieldsRepository.find({ where: { tenantId }, order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  async findOneOrFail(id: number, tenantId: number): Promise<TestCaseCustomField> {
    const field = await this.fieldsRepository.findOne({ where: { id, tenantId } });
    if (!field) {
      throw new NotFoundException(`Custom field #${id} not found`);
    }
    return field;
  }

  // Names are matched against spreadsheet headers loosely (see
  // normalizeHeader()), so uniqueness is checked the same loose way -
  // "Test Type" and "test_type" would otherwise both claim one column.
  private async assertNameAvailable(name: string, tenantId: number, excludeId?: number): Promise<void> {
    if (!normalizeHeader(name)) {
      throw new BadRequestException('Name must contain at least one letter or number.');
    }
    if (isReservedFieldName(name)) {
      throw new BadRequestException(`"${name}" is already a built-in test case column - pick a different name.`);
    }
    const existing = await this.findAll(tenantId);
    const clash = existing.find((f) => f.id !== excludeId && normalizeHeader(f.name) === normalizeHeader(name));
    if (clash) {
      throw new ConflictException(`A custom field named "${clash.name}" already exists.`);
    }
  }

  private normalizeOptions(fieldType: CustomFieldType, options: string[] | undefined): string[] {
    if (fieldType !== CustomFieldType.DROPDOWN) return [];
    const cleaned = (options || []).map((o) => o.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      throw new BadRequestException('A Dropdown field needs at least one option.');
    }
    const tooLong = cleaned.find((o) => o.length > MAX_OPTION_LENGTH);
    if (tooLong) {
      throw new BadRequestException(`Option "${tooLong.slice(0, 30)}..." is longer than ${MAX_OPTION_LENGTH} characters.`);
    }
    const seen = new Set<string>();
    for (const option of cleaned) {
      if (seen.has(option.toLowerCase())) {
        throw new BadRequestException(`Option "${option}" is listed more than once.`);
      }
      seen.add(option.toLowerCase());
    }
    return cleaned;
  }

  async create(dto: CreateTestCaseCustomFieldDto, user: { id: number; email: string }, tenantId: number): Promise<TestCaseCustomField> {
    const name = dto.name.trim();
    await this.assertNameAvailable(name, tenantId);
    const field = this.fieldsRepository.create({
      name,
      fieldType: dto.fieldType,
      options: this.normalizeOptions(dto.fieldType, dto.options),
      isRequired: dto.isRequired ?? false,
      sortOrder: dto.sortOrder ?? 0,
      tenantId,
    });
    const saved = await this.fieldsRepository.save(field);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TEST_CASE_CUSTOM_FIELD_CREATED,
      tenantId,
      entityType: 'TestCaseCustomField',
      entityId: saved.id,
      details: { name: saved.name, fieldType: saved.fieldType, options: saved.options, isRequired: saved.isRequired },
    });
    return saved;
  }

  async update(
    id: number,
    dto: UpdateTestCaseCustomFieldDto,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<TestCaseCustomField> {
    const field = await this.findOneOrFail(id, tenantId);
    const previous = { ...field };

    if (dto.name !== undefined && dto.name.trim() !== field.name) {
      await this.assertNameAvailable(dto.name.trim(), tenantId, id);
      field.name = dto.name.trim();
    }
    // Removing an option leaves any value already saved under it in
    // place - resolveValues() accepts an unchanged value even if it's no
    // longer a listed option, so old cases stay editable.
    if (dto.options !== undefined) field.options = this.normalizeOptions(field.fieldType, dto.options);
    if (dto.isRequired !== undefined) field.isRequired = dto.isRequired;
    if (dto.sortOrder !== undefined) field.sortOrder = dto.sortOrder;
    const saved = await this.fieldsRepository.save(field);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TEST_CASE_CUSTOM_FIELD_UPDATED,
      tenantId,
      entityType: 'TestCaseCustomField',
      entityId: saved.id,
      details: { previous, updated: dto },
    });
    return saved;
  }

  async setActive(id: number, isActive: boolean, user: { id: number; email: string }, tenantId: number): Promise<TestCaseCustomField> {
    const field = await this.findOneOrFail(id, tenantId);
    field.isActive = isActive;
    const saved = await this.fieldsRepository.save(field);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: isActive ? AuditActions.TEST_CASE_CUSTOM_FIELD_ACTIVATED : AuditActions.TEST_CASE_CUSTOM_FIELD_DEACTIVATED,
      tenantId,
      entityType: 'TestCaseCustomField',
      entityId: saved.id,
    });
    return saved;
  }

  // Only a field no test case has a value for can be deleted - otherwise
  // those values would silently disappear. Deactivate it instead.
  async remove(id: number, user: { id: number; email: string }, tenantId: number): Promise<void> {
    const field = await this.findOneOrFail(id, tenantId);
    const usageCount = await this.testCasesRepository
      .createQueryBuilder('tc')
      .where('tc.tenantId = :tenantId', { tenantId })
      .andWhere('(tc."customFields" -> :key) IS NOT NULL', { key: String(id) })
      .getCount();
    if (usageCount > 0) {
      throw new ConflictException(
        `"${field.name}" has a value on ${usageCount} test case(s) and can't be deleted - deactivate it instead.`,
      );
    }
    await this.fieldsRepository.delete(id);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TEST_CASE_CUSTOM_FIELD_DELETED,
      tenantId,
      entityType: 'TestCaseCustomField',
      entityId: id,
      details: { deleted: field },
    });
  }

  // Validates/normalizes one raw value for a field. Accepts both typed
  // JSON (from the create/edit form) and plain strings (from a
  // spreadsheet cell).
  coerceValue(field: TestCaseCustomField, raw: unknown): CoerceResult {
    switch (field.fieldType) {
      case CustomFieldType.TEXT: {
        const value = String(raw).trim();
        if (value.length > MAX_TEXT_LENGTH) {
          return { ok: false, message: `"${field.name}" is longer than ${MAX_TEXT_LENGTH} characters` };
        }
        return { ok: true, value };
      }
      case CustomFieldType.NUMBER: {
        const value = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/,/g, ''));
        if (!Number.isFinite(value)) {
          return { ok: false, message: `"${field.name}" must be a number (got "${raw}")` };
        }
        return { ok: true, value };
      }
      case CustomFieldType.DATE: {
        const value = String(raw).trim();
        if (!isValidIsoDate(value)) {
          return { ok: false, message: `"${field.name}" must be a date in YYYY-MM-DD format (got "${raw}")` };
        }
        return { ok: true, value };
      }
      case CustomFieldType.DROPDOWN: {
        const value = String(raw).trim();
        const match = field.options.find((o) => o.toLowerCase() === value.toLowerCase());
        if (!match) {
          return { ok: false, message: `"${field.name}" must be one of: ${field.options.join(', ')} (got "${raw}")` };
        }
        return { ok: true, value: match };
      }
    }
  }

  // For the create/edit API. Merges `input` (field id -> value; null or
  // '' clears) over `existing`, validating every changed value. When
  // enforceRequired is set, every active required field must end up with
  // a value - on create always, on update only when the request touched
  // customFields at all, so editing just a title on a case that predates
  // a newly-required field isn't blocked.
  resolveValues(
    fields: TestCaseCustomField[],
    input: Record<string, unknown> | undefined,
    existing: CustomFieldValues,
    enforceRequired: boolean,
  ): CustomFieldValues {
    const byId = new Map(fields.map((f) => [String(f.id), f]));
    const result: CustomFieldValues = { ...(existing || {}) };

    for (const [key, raw] of Object.entries(input || {})) {
      const field = byId.get(key);
      if (!field) {
        throw new BadRequestException(`Unknown custom field #${key}.`);
      }
      if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
        delete result[key];
        continue;
      }
      // An unchanged value is always accepted, even if the field has since
      // been deactivated or the dropdown option removed.
      if (existing && existing[key] === raw) continue;
      if (!field.isActive) {
        throw new BadRequestException(`Custom field "${field.name}" is inactive and can't be set.`);
      }
      if (typeof raw !== 'string' && typeof raw !== 'number') {
        throw new BadRequestException(`Invalid value for custom field "${field.name}".`);
      }
      const coerced = this.coerceValue(field, raw);
      if (!coerced.ok) {
        throw new BadRequestException(coerced.message);
      }
      result[key] = coerced.value;
    }

    if (enforceRequired) {
      const missing = fields.filter((f) => f.isActive && f.isRequired && (result[String(f.id)] ?? '') === '');
      if (missing.length > 0) {
        throw new BadRequestException(`Required custom field(s) missing: ${missing.map((f) => f.name).join(', ')}`);
      }
    }
    return result;
  }
}
