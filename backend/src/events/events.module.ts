import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { GuardsModule } from '../common/guards.module';
import { ClientPortalCoreModule } from '../client-portal/client-portal-core.module';

@Module({
  imports: [GuardsModule, ClientPortalCoreModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
