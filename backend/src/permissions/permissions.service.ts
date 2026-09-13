import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './role.entity';
import { RolePermission } from './role-permission.entity';

// Read-only lookup over the permissions foundation tables (PROJECT.md
// §14). Not called from any guard or controller yet - existing role
// checks throughout the app are untouched and remain the actual source
// of truth. This exists to let the seeded data be verified against that
// still-current logic before anything is migrated to depend on it.
@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Role)
    private rolesRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private rolePermissionsRepository: Repository<RolePermission>,
  ) {}

  // System roles are shared globally (tenantId NULL) - tenantId is only
  // needed to also find a tenant's own custom roles once those exist.
  async hasPermission(roleKey: string, actionKey: string, tenantId?: number): Promise<boolean> {
    const role = await this.rolesRepository.findOne({
      where: [
        { key: roleKey, tenantId: null as any, isActive: true },
        ...(tenantId ? [{ key: roleKey, tenantId, isActive: true }] : []),
      ],
    });
    if (!role) {
      return false;
    }
    const grant = await this.rolePermissionsRepository.findOne({
      where: { roleId: role.id, actionKey },
    });
    return grant !== null;
  }

  async getGrantedActions(roleKey: string, tenantId?: number): Promise<RolePermission[]> {
    const role = await this.rolesRepository.findOne({
      where: [
        { key: roleKey, tenantId: null as any, isActive: true },
        ...(tenantId ? [{ key: roleKey, tenantId, isActive: true }] : []),
      ],
    });
    if (!role) {
      return [];
    }
    return this.rolePermissionsRepository.find({ where: { roleId: role.id } });
  }
}
