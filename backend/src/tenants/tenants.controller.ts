import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformSuperadminGuard } from '../common/platform-superadmin.guard';

// Multi-tenant conversion Phase E: staff-only tenant provisioning.
// Gated by PlatformSuperadminGuard, not AdminGuard - a tenant's own
// admin has no access here, only whoever holds platform-wide
// isPlatformSuperadmin.
@Controller('platform/tenants')
@UseGuards(JwtAuthGuard, PlatformSuperadminGuard)
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  @Get()
  findAll() {
    return this.tenantsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }
}
