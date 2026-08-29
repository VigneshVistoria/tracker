import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { UsersModule } from '../users/users.module';
import { GuardsModule } from '../common/guards.module';

// Phase A registered just the entity; Phase B added TenantsService
// (host-based tenant resolution, used by AuthModule) so login/register
// can be scoped per tenant. Phase E adds the provisioning controller
// (staff-only, PlatformSuperadminGuard) and UsersModule so it can create
// each new tenant's first admin user.
@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), UsersModule, GuardsModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TypeOrmModule, TenantsService],
})
export class TenantsModule {}
