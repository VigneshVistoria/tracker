import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { GuardsModule } from '../common/guards.module';

@Module({
  imports: [GuardsModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
