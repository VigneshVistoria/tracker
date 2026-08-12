import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamsSubscription } from './teams-subscription.entity';
import { TeamsIntegrationController } from './teams-integration.controller';
import { GraphAuthService } from './graph-auth.service';
import { TeamsGraphService } from './teams-graph.service';
import { TeamsMessageConverterService } from './teams-message-converter.service';
import { TeamsRenewalService } from './teams-renewal.service';
import { TeamsAssignmentNotifierService } from './teams-assignment-notifier.service';
import { GuardsModule } from '../common/guards.module';
import { IssuesModule } from '../issues/issues.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([TeamsSubscription]), GuardsModule, IssuesModule, UsersModule],
  controllers: [TeamsIntegrationController],
  providers: [
    GraphAuthService,
    TeamsGraphService,
    TeamsMessageConverterService,
    TeamsRenewalService,
    TeamsAssignmentNotifierService,
  ],
})
export class TeamsIntegrationModule {}
