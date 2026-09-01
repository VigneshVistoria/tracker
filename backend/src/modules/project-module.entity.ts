import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// A module groups a project's issues into a mid-level bucket for the
// project drill-down (project -> module -> issue). Deliberately as thin
// as Sprint - status/completion/risk are never stored here, only derived
// from the module's issues on read (see ModulesService), same reasoning
// the Weekly Report already uses: a stored rollup can drift stale, a
// computed one can't.
@Entity('modules')
export class ProjectModule {
  @PrimaryGeneratedColumn()
  id: number;

  // Multi-tenant conversion Phase A - unused until Phase C wires up query
  // filtering. Nullable only until the migration's backfill runs, which
  // also adds the NOT NULL + FK.
  @Column({ nullable: true })
  tenantId: number;

  // Modules belong to exactly one project - there's no cross-project module.
  @Column()
  projectId: number;

  @Column({ nullable: true })
  projectName: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  createdByUserId: number;

  // Deactivate rather than hard-delete when a module is already
  // referenced elsewhere (linked issues, Project Planning entries) -
  // hidden from "assign to a module" pickers once false, but its
  // existing links/history stay intact and still visible in the
  // project/module drill-down.
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
