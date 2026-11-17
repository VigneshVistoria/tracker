import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { GuardsModule } from '../common/guards.module';
import { MyWorkScreenService } from './my-work-screen.service';
import { MyWorkScreenController } from './my-work-screen.controller';

// "New My work screen" setting (2026-11-17) - see ./my-work-screen.ts.
@Module({
  imports: [TypeOrmModule.forFeature([TeamSettings, User]), UsersModule, AuditModule, GuardsModule],
  controllers: [MyWorkScreenController],
  providers: [MyWorkScreenService],
})
export class MyWorkScreenModule {}
