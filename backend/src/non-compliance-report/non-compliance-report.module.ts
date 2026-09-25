import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { NonComplianceReportService } from './non-compliance-report.service';
import { NonComplianceReportController } from './non-compliance-report.controller';
import { PdfNonComplianceReportService } from './pdf-non-compliance-report.service';
import { UsersModule } from '../users/users.module';
import { GuardsModule } from '../common/guards.module';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectTask, TaskQaReview]), UsersModule, GuardsModule],
  controllers: [NonComplianceReportController],
  providers: [NonComplianceReportService, PdfNonComplianceReportService],
})
export class NonComplianceReportModule {}
