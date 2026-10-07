import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// A client company served through the client portal (design/client-portal-
// v3.html), e.g. Amanah Insurance. Separate from `tenants` (the platform
// tenant behind a login domain) - one tenant holds many clients, and the
// internal team works across them. Scope decided with the user 2026-10-07:
// only clients added here use the portal; existing client-role users and
// projects (e.g. LMS) keep the old workflow untouched. See
// migrations/2026-10-client-portal-foundation.sql.
@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ length: 200 })
  name: string;

  // The client's project - its modules are this project's modules.
  @Column()
  projectId: number;

  @Column({ type: 'int', nullable: true })
  keyContactUserId: number | null;

  // Master switch. While false, nothing about the portal applies to this
  // client's users (they keep the old client workflow) - flipped on only
  // once the portal screens ship.
  @Column({ default: false })
  portalEnabled: boolean;

  @Column({ default: true })
  isActive: boolean;

  // Shown before the client's ticket numbers, e.g. AM-12 (Stage 2).
  @Column({ type: 'varchar', length: 10, default: 'CT' })
  ticketPrefix: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
