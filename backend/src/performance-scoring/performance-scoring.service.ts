import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PerformanceScoringConfig, OverduePenaltyMode } from './performance-scoring-config.entity';
import { OverduePenaltyTier } from './overdue-penalty-tier.entity';
import { UpdatePerformanceScoringConfigDto } from './dto/update-performance-scoring-config.dto';
import { CreateOverduePenaltyTierDto } from './dto/create-overdue-penalty-tier.dto';
import { UpdateOverduePenaltyTierDto } from './dto/update-overdue-penalty-tier.dto';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

export interface EffectiveScoringConfig {
  config: PerformanceScoringConfig;
  tiers: OverduePenaltyTier[];
}

@Injectable()
export class PerformanceScoringService {
  constructor(
    @InjectRepository(PerformanceScoringConfig)
    private configRepository: Repository<PerformanceScoringConfig>,
    @InjectRepository(OverduePenaltyTier)
    private tiersRepository: Repository<OverduePenaltyTier>,
    private auditLogService: AuditLogService,
  ) {}

  // The migration seeds exactly one row - this is a defensive fallback
  // only, so a missing row (e.g. a bad manual delete) doesn't 500 every
  // score calculation.
  private async getOrCreateConfigRow(): Promise<PerformanceScoringConfig> {
    const existing = await this.configRepository.find({ take: 1 });
    if (existing.length > 0) return existing[0];
    return this.configRepository.save(this.configRepository.create({}));
  }

  async getEffectiveConfig(): Promise<EffectiveScoringConfig> {
    const [config, tiers] = await Promise.all([
      this.getOrCreateConfigRow(),
      this.tiersRepository.find({ order: { sortOrder: 'ASC', minDaysLate: 'ASC' } }),
    ]);
    return { config, tiers };
  }

  async updateConfig(
    dto: UpdatePerformanceScoringConfigDto,
    user: { id: number; email: string },
  ): Promise<PerformanceScoringConfig> {
    const existing = await this.getOrCreateConfigRow();
    const previous = { ...existing };

    if (dto.overduePenaltyMode !== undefined) existing.overduePenaltyMode = dto.overduePenaltyMode;
    if (dto.flatOverduePenaltyPercent !== undefined) existing.flatOverduePenaltyPercent = dto.flatOverduePenaltyPercent;
    if (dto.qaFailedWeightPercent !== undefined) existing.qaFailedWeightPercent = dto.qaFailedWeightPercent;
    if (dto.reopenedWeightPercent !== undefined) existing.reopenedWeightPercent = dto.reopenedWeightPercent;
    if (dto.lateDependencyWeightPercent !== undefined) existing.lateDependencyWeightPercent = dto.lateDependencyWeightPercent;
    if (dto.earlyCompletionBonusPercent !== undefined) existing.earlyCompletionBonusPercent = dto.earlyCompletionBonusPercent;
    existing.updatedByUserId = user.id;
    existing.updatedByEmail = user.email;

    const saved = await this.configRepository.save(existing);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.SCORING_CONFIG_UPDATED,
      entityType: 'PerformanceScoringConfig',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }

  async createTier(dto: CreateOverduePenaltyTierDto, user: { id: number; email: string }): Promise<OverduePenaltyTier> {
    const tier = this.tiersRepository.create({
      minDaysLate: dto.minDaysLate,
      maxDaysLate: dto.maxDaysLate ?? null,
      penaltyPercent: dto.penaltyPercent,
      sortOrder: dto.sortOrder ?? dto.minDaysLate,
    });
    const saved = await this.tiersRepository.save(tier);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.OVERDUE_TIER_CREATED,
      entityType: 'OverduePenaltyTier',
      entityId: saved.id,
      details: { ...dto },
    });

    return saved;
  }

  async updateTier(
    id: number,
    dto: UpdateOverduePenaltyTierDto,
    user: { id: number; email: string },
  ): Promise<OverduePenaltyTier> {
    const tier = await this.tiersRepository.findOne({ where: { id } });
    if (!tier) {
      throw new NotFoundException(`Overdue penalty tier #${id} not found`);
    }
    const previous = { ...tier };

    if (dto.minDaysLate !== undefined) tier.minDaysLate = dto.minDaysLate;
    if (dto.maxDaysLate !== undefined) tier.maxDaysLate = dto.maxDaysLate;
    if (dto.penaltyPercent !== undefined) tier.penaltyPercent = dto.penaltyPercent;
    if (dto.sortOrder !== undefined) tier.sortOrder = dto.sortOrder;

    const saved = await this.tiersRepository.save(tier);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.OVERDUE_TIER_UPDATED,
      entityType: 'OverduePenaltyTier',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }

  async removeTier(id: number, user: { id: number; email: string }): Promise<void> {
    const tier = await this.tiersRepository.findOne({ where: { id } });
    if (!tier) {
      throw new NotFoundException(`Overdue penalty tier #${id} not found`);
    }
    await this.tiersRepository.delete(id);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.OVERDUE_TIER_DELETED,
      entityType: 'OverduePenaltyTier',
      entityId: id,
      details: { deleted: tier },
    });
  }

  // The per-item overdue penalty for a single issue that's daysLate days
  // past its SLA due date - Tiered mode finds the matching bracket
  // (falling back to the closest tier if daysLate exceeds every bounded
  // tier and there's no unbounded one configured, so a gap in tier
  // coverage never means "no penalty" by accident); Flat mode ignores
  // tiers entirely.
  resolveOverduePenaltyPercent(daysLate: number, effective: EffectiveScoringConfig): number {
    if (effective.config.overduePenaltyMode === OverduePenaltyMode.FLAT) {
      return effective.config.flatOverduePenaltyPercent;
    }
    const match = effective.tiers.find(
      (t) => daysLate >= t.minDaysLate && (t.maxDaysLate == null || daysLate <= t.maxDaysLate),
    );
    if (match) return match.penaltyPercent;
    if (effective.tiers.length === 0) return 0;
    // No configured tier covers this many days late - use the highest
    // one available rather than silently applying zero penalty.
    return effective.tiers[effective.tiers.length - 1].penaltyPercent;
  }
}
