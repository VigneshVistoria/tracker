import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BaScopeGuard } from '../common/ba-scope.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { StorageModule } from '../storage/storage.module';
import { SrsDocument } from './entities/srs-document.entity';
import { SrsRequirement } from './entities/srs-requirement.entity';
import { SrsEpic } from './entities/srs-epic.entity';
import { SrsStory } from './entities/srs-story.entity';
import { SrsStoryRequirement } from './entities/srs-story-requirement.entity';
import { SrsCriterion } from './entities/srs-criterion.entity';
import { SrsCriterionResult } from './entities/srs-criterion-result.entity';
import { SrsStoryTicket } from './entities/srs-story-ticket.entity';
import { SrsTicketCriterion } from './entities/srs-ticket-criterion.entity';
import { SrsClientItem } from './entities/srs-client-item.entity';
import { SrsClientItemStory } from './entities/srs-client-item-story.entity';
import { RequirementsService } from './requirements.service';
import { RequirementsEditService } from './requirements-edit.service';
import { RequirementsClientService } from './requirements-client.service';
import { RequirementsTicketsService } from './requirements-tickets.service';
import { RequirementsController } from './requirements.controller';

export const REQUIREMENTS_ENTITIES = [SrsDocument, SrsRequirement, SrsEpic, SrsStory, SrsStoryRequirement, SrsCriterion, SrsCriterionResult, SrsStoryTicket, SrsTicketCriterion, SrsClientItem, SrsClientItemStory];

// Requirements traceability (2026-11-25) - see ./requirements.ts.
@Module({
  imports: [TypeOrmModule.forFeature([TeamSettings, ...REQUIREMENTS_ENTITIES]), UsersModule, AuditModule, GuardsModule, StorageModule],
  controllers: [RequirementsController],
  // BaScopeGuard is app-wide (APP_GUARD): a Business Analyst may only use
  // Requirements (see common/ba-scope.guard.ts). No effect on other roles.
  providers: [RequirementsService, RequirementsEditService, RequirementsClientService, RequirementsTicketsService, { provide: APP_GUARD, useClass: BaScopeGuard }],
})
export class RequirementsModule {}
