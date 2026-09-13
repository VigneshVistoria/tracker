import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// One row per (role, action) grant - see Role entity's comment and
// PROJECT.md §14. scope is only meaningful for actions where "can do
// this at all" isn't the same question as "on which rows" (e.g.
// kpi.view_report is inherently cross-assignee, so its scope is always
// 'all'; an action with no row-scoping concept leaves scope null).
@Entity('role_permissions')
export class RolePermission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  roleId: number;

  @Column()
  actionKey: string;

  @Column({ nullable: true })
  scope: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
