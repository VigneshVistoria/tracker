import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { User } from './users/user.entity';
import { Issue } from './issues/issue.entity';
import { Project } from './projects/project.entity';
import { DailyUpdate } from './daily-updates/daily-update.entity';
import { TeamsSubscription } from './teams-integration/teams-subscription.entity';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { IssuesModule } from './issues/issues.module';
import { ProjectsModule } from './projects/projects.module';
import { DailyUpdatesModule } from './daily-updates/daily-updates.module';
import { TeamsIntegrationModule } from './teams-integration/teams-integration.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        entities: [User, Issue, Project, DailyUpdate, TeamsSubscription],
        // synchronize auto-creates tables from entities. Great for
        // learning/dev, but turn this OFF and use migrations in production.
        synchronize: true,
        // Supabase requires SSL. rejectUnauthorized: false is the standard
        // setting for Supabase's connection pooler / direct connection.
        ssl: { rejectUnauthorized: false },
      }),
    }),
    UsersModule,
    AuthModule,
    IssuesModule,
    ProjectsModule,
    DailyUpdatesModule,
    TeamsIntegrationModule,
  ],
})
export class AppModule {}
