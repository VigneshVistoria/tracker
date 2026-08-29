import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity';

// Foundations-only (multi-tenant conversion Phase A): registers the
// entity so Phase B (auth/JWT tenant claim) and Phase C (query scoping)
// can inject its repository without more module plumbing. No controller
// yet - tenant provisioning is Phase E.
@Module({
  imports: [TypeOrmModule.forFeature([Tenant])],
  exports: [TypeOrmModule],
})
export class TenantsModule {}
