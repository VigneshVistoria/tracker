import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Foundation for a future admin-manageable role/permission system (see
// PROJECT.md §14). Not yet wired to anything - `User.role` is still the
// live authorization source of truth everywhere in the app; this table
// only mirrors the six existing role values for now, seeded by
// 2026-09-permissions-foundation.sql. tenantId is NULL for those six
// system roles (isProtected = true, shared by every tenant) and will be
// set for a tenant's own custom roles once an admin UI to create them
// exists.
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  tenantId: number | null;

  @Column()
  key: string;

  @Column()
  name: string;

  @Column({ default: false })
  isProtected: boolean;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
