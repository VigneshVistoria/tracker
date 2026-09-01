import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team)
    private teamsRepository: Repository<Team>,
    private auditLogService: AuditLogService,
  ) {}

  private async assertNameAvailable(name: string, tenantId: number, excludeId?: number): Promise<void> {
    const existing = await this.teamsRepository.findOne({ where: { name, tenantId } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`A team named "${name}" already exists.`);
    }
  }

  findAll(tenantId: number): Promise<Team[]> {
    return this.teamsRepository.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async findOneOrFail(id: number, tenantId: number): Promise<Team> {
    const team = await this.teamsRepository.findOne({ where: { id, tenantId } });
    if (!team) {
      throw new NotFoundException(`Team #${id} not found`);
    }
    return team;
  }

  async create(dto: CreateTeamDto, user: { id: number; email: string }, tenantId: number): Promise<Team> {
    await this.assertNameAvailable(dto.name, tenantId);
    const team = this.teamsRepository.create({ ...dto, tenantId });
    const saved = await this.teamsRepository.save(team);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TEAM_CREATED,
      tenantId,
      entityType: 'Team',
      entityId: saved.id,
      details: { ...dto },
    });

    return saved;
  }

  async update(id: number, dto: UpdateTeamDto, user: { id: number; email: string }, tenantId: number): Promise<Team> {
    const team = await this.findOneOrFail(id, tenantId);
    if (dto.name !== undefined && dto.name !== team.name) {
      await this.assertNameAvailable(dto.name, tenantId, id);
    }
    const previous = { ...team };

    if (dto.name !== undefined) team.name = dto.name;
    if (dto.description !== undefined) team.description = dto.description;

    const saved = await this.teamsRepository.save(team);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TEAM_UPDATED,
      tenantId,
      entityType: 'Team',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }

  async setActive(id: number, isActive: boolean, user: { id: number; email: string }, tenantId: number): Promise<Team> {
    const team = await this.findOneOrFail(id, tenantId);
    team.isActive = isActive;
    const saved = await this.teamsRepository.save(team);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: isActive ? AuditActions.TEAM_ACTIVATED : AuditActions.TEAM_DEACTIVATED,
      tenantId,
      entityType: 'Team',
      entityId: saved.id,
    });

    return saved;
  }

  async remove(id: number, user: { id: number; email: string }, tenantId: number): Promise<void> {
    const team = await this.findOneOrFail(id, tenantId);
    // Nothing references teams yet - this table is standalone for now
    // (see plan). Once Users/Issues gain a real FK to this table, add a
    // reference check here and throw ConflictException instead of deleting.
    await this.teamsRepository.delete(id);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.TEAM_DELETED,
      tenantId,
      entityType: 'Team',
      entityId: id,
      details: { deleted: team },
    });
  }
}
