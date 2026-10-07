import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from './client.entity';
import { ClientUser } from './client-user.entity';
import { ClientTeamMember } from './client-team-member.entity';
import { ClientAccessService } from './client-access.service';
import { BlockPortalClientsGuard } from './block-portal-clients.guard';

// The access rules and the portal-user guard on their own, with no
// imports beyond their own tables, so internal modules (issues, users,
// sprints, modules, events) can use the guard without a circular import
// back to ClientPortalModule.
@Module({
  imports: [TypeOrmModule.forFeature([Client, ClientUser, ClientTeamMember])],
  providers: [ClientAccessService, BlockPortalClientsGuard],
  exports: [ClientAccessService, BlockPortalClientsGuard, TypeOrmModule],
})
export class ClientPortalCoreModule {}
