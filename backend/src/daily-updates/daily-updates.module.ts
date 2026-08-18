import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyUpdate } from './daily-update.entity';
import { DailyUpdatesService } from './daily-updates.service';
import { DailyUpdatesController } from './daily-updates.controller';
import { DailyUpdateAnalyzerService } from './daily-update-analyzer.service';
import { GuardsModule } from '../common/guards.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [TypeOrmModule.forFeature([DailyUpdate]), GuardsModule, EventsModule],
  controllers: [DailyUpdatesController],
  providers: [DailyUpdatesService, DailyUpdateAnalyzerService],
  exports: [DailyUpdatesService],
})
export class DailyUpdatesModule {}
