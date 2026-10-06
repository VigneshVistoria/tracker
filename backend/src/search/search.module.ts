import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { GuardsModule } from '../common/guards.module';
import { IssuesModule } from '../issues/issues.module';
import { TasksModule } from '../tasks/tasks.module';
import { TestCasesModule } from '../test-cases/test-cases.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [GuardsModule, IssuesModule, TasksModule, TestCasesModule, UsersModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
