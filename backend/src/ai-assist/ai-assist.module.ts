import { Module } from '@nestjs/common';
import { AiAssistService } from './ai-assist.service';
import { AiAssistController } from './ai-assist.controller';
import { GuardsModule } from '../common/guards.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [GuardsModule, UsersModule],
  controllers: [AiAssistController],
  providers: [AiAssistService],
})
export class AiAssistModule {}
