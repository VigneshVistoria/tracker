import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestCase } from './test-case.entity';
import { TestExecution } from './test-execution.entity';
import { TestCasesService } from './test-cases.service';
import { TestCasesController } from './test-cases.controller';
import { GuardsModule } from '../common/guards.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [TypeOrmModule.forFeature([TestCase, TestExecution]), GuardsModule, UsersModule, ProjectsModule],
  controllers: [TestCasesController],
  providers: [TestCasesService],
  exports: [TestCasesService],
})
export class TestCasesModule {}
