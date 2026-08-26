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

  @CreateDateColumn()
  createdAt: Date;
}
