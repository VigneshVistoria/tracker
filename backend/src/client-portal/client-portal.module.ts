import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientTicket } from './client-ticket.entity';
import { ClientRequest } from './client-request.entity';
import { ProjectModule } from '../modules/project-module.entity';
import { User } from '../users/user.entity';
import { ClientPortalCoreModule } from './client-portal-core.module';
import { ClientPortalService } from './client-portal.service';
import { ClientPortalController } from './client-portal.controller';
import { UsersModule } from '../users/users.module';
import { GuardsModule } from '../common/guards.module';

// Client portal (design/client-portal-v3.html). GuardsModule is required
// for JwtAuthGuard's JwtService - leaving it out crash-loops the backend.
@Module({
  imports: [
    TypeOrmModule.forFeature([ClientTicket, ClientRequest, ProjectModule, User]),
    ClientPortalCoreModule,
    UsersModule,
    GuardsModule,
  ],
  controllers: [ClientPortalController],
  providers: [ClientPortalService],
})
export class ClientPortalModule {}
