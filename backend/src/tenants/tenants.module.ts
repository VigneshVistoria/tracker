import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity';
import { TenantsService } from './tenants.service';

// Phase A registered just the entity; Phase B adds TenantsService
// (host-based tenant resolution, used by AuthModule) so login/register
// can be scoped per tenant. Still no controller - tenant provisioning
// is Phase E.
@Module({
  imports: [TypeOrmModule.forFeature([Tenant])],
  providers: [TenantsService],
  exports: [TypeOrmModule, TenantsService],
})
export class TenantsModule {}
