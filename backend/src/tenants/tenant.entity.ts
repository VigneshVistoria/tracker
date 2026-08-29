import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// Multi-tenant conversion Phase A (schema foundation only - see the
// migration this ships with for the tenantId backfill across every other
// table). `subdomain` is the slug a request's Host header resolves to
// once Phase D's wildcard DNS/nginx work lands; until then every request
// falls back to the first tenant created (see Phase B/D notes elsewhere).
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ unique: true })
  subdomain: string;

  @CreateDateColumn()
  createdAt: Date;
}
