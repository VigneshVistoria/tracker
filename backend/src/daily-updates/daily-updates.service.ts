import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { DailyUpdate, UpdateStatus } from './daily-update.entity';
import { CreateDailyUpdateDto } from './dto/create-daily-update.dto';
import { DailyUpdateAnalyzerService } from './daily-update-analyzer.service';
import { EventsGateway } from '../events/events.gateway';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class DailyUpdatesService {
  constructor(
    @InjectRepository(DailyUpdate)
    private repo: Repository<DailyUpdate>,
    private analyzer: DailyUpdateAnalyzerService,
    private eventsGateway: EventsGateway,
  ) {}

  async create(dto: CreateDailyUpdateDto, userId: number, userEmail: string): Promise<DailyUpdate> {
    const date = dto.date || todayIso();

    // Find this person's most recent update strictly before today's date,
    // so we know what was left pending last time.
    const previous = await this.repo.findOne({
      where: { userId, date: LessThan(date) },
      order: { date: 'DESC' },
    });
    const previousPendingTasks = previous?.pendingTasks || [];

    const analysis = this.analyzer.analyze(
      dto.completedText,
      dto.pendingText,
      dto.blockersText,
      previousPendingTasks,
    );

    const update = this.repo.create({
      userId,
      userEmail,
      date,
      completedText: dto.completedText,
      pendingText: dto.pendingText,
      blockersText: dto.blockersText,
      ...analysis,
    });

    const saved = await this.repo.save(update);
    this.eventsGateway.emitDailyUpdateCreated(saved);
    return saved;
  }

  findHistoryForUser(userId: number): Promise<DailyUpdate[]> {
    return this.repo.find({ where: { userId }, order: { date: 'DESC' } });
  }

  findAll(date?: string): Promise<DailyUpdate[]> {
    return this.repo.find({
      where: date ? { date } : {},
      order: { date: 'DESC', userEmail: 'ASC' },
    });
  }

  async teamSummary(date?: string) {
    const targetDate = date || todayIso();
    const updates = await this.repo.find({ where: { date: targetDate } });

    const counts = { on_track: 0, at_risk: 0, blocked: 0 };
    for (const u of updates) counts[u.status] = (counts[u.status] || 0) + 1;

    const avgProductivity = updates.length
      ? Math.round(updates.reduce((sum, u) => sum + u.productivityScore, 0) / updates.length)
      : 0;

    return {
      date: targetDate,
      submittedCount: updates.length,
      counts,
      avgProductivity,
      updates,
    };
  }
}
