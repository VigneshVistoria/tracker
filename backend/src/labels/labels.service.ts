import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Label } from './label.entity';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

@Injectable()
export class LabelsService {
  constructor(
    @InjectRepository(Label)
    private labelsRepository: Repository<Label>,
    private auditLogService: AuditLogService,
  ) {}

  private async assertNameAvailable(name: string, tenantId: number, excludeId?: number): Promise<void> {
    const existing = await this.labelsRepository.findOne({ where: { name, tenantId } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`A label named "${name}" already exists.`);
    }
  }

  findAll(tenantId: number): Promise<Label[]> {
    return this.labelsRepository.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async findOneOrFail(id: number, tenantId: number): Promise<Label> {
    const label = await this.labelsRepository.findOne({ where: { id, tenantId } });
    if (!label) {
      throw new NotFoundException(`Label #${id} not found`);
    }
    return label;
  }

  async create(dto: CreateLabelDto, user: { id: number; email: string }, tenantId: number): Promise<Label> {
    await this.assertNameAvailable(dto.name, tenantId);
    const label = this.labelsRepository.create({ ...dto, tenantId });
    const saved = await this.labelsRepository.save(label);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.LABEL_CREATED,
      tenantId,
      entityType: 'Label',
      entityId: saved.id,
      details: { ...dto },
    });

    return saved;
  }

  async update(id: number, dto: UpdateLabelDto, user: { id: number; email: string }, tenantId: number): Promise<Label> {
    const label = await this.findOneOrFail(id, tenantId);
    if (dto.name !== undefined && dto.name !== label.name) {
      await this.assertNameAvailable(dto.name, tenantId, id);
    }
    const previous = { ...label };

    if (dto.name !== undefined) label.name = dto.name;
    if (dto.description !== undefined) label.description = dto.description;

    const saved = await this.labelsRepository.save(label);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.LABEL_UPDATED,
      tenantId,
      entityType: 'Label',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }

  async setActive(id: number, isActive: boolean, user: { id: number; email: string }, tenantId: number): Promise<Label> {
    const label = await this.findOneOrFail(id, tenantId);
    label.isActive = isActive;
    const saved = await this.labelsRepository.save(label);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: isActive ? AuditActions.LABEL_ACTIVATED : AuditActions.LABEL_DEACTIVATED,
      tenantId,
      entityType: 'Label',
      entityId: saved.id,
    });

    return saved;
  }

  async remove(id: number, user: { id: number; email: string }, tenantId: number): Promise<void> {
    const label = await this.findOneOrFail(id, tenantId);
    // Nothing references labels yet - this table is standalone for now
    // (see plan). Once Issues gain a real label link, add a reference
    // check here and throw ConflictException instead of deleting.
    await this.labelsRepository.delete(id);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.LABEL_DELETED,
      tenantId,
      entityType: 'Label',
      entityId: id,
      details: { deleted: label },
    });
  }
}
