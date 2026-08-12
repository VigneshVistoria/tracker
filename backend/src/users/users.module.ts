import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { Project } from '../projects/project.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { GuardsModule } from '../common/guards.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, Project]), GuardsModule, EventsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
