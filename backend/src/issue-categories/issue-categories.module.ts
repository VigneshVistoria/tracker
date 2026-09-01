import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IssueCategoryOption } from './issue-category.entity';
import { IssueCategoriesService } from './issue-categories.service';
import { IssueCategoriesController } from './issue-categories.controller';
import { GuardsModule } from '../common/guards.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { Issue } from '../issues/issue.entity';

@Module({
  imports: [TypeOrmModule.forFeature([IssueCategoryOption, Issue]), GuardsModule, AuditModule, UsersModule],
  controllers: [IssueCategoriesController],
  providers: [IssueCategoriesService],
  exports: [IssueCategoriesService],
})
export class IssueCategoriesModule {}
