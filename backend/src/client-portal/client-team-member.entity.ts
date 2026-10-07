import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export const CLIENT_TEAM_ROLES = ['developer', 'qa', 'pm'] as const;
export type ClientTeamRole = (typeof CLIENT_TEAM_ROLES)[number];

// An internal user on a client's dedicated team. Scopes portal data only:
// it decides which clients' tickets/requests this user sees in the portal,
// and never narrows their other work (e.g. LMS tasks/issues).
@Entity('client_team_members')
export class ClientTeamMember {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  clientId: number;

  @Column()
  userId: number;

  @Column({ type: 'varchar', length: 20 })
  teamRole: ClientTeamRole;

  // Email routing defaults from the design's "Clients & teams" card.
  @Column({ default: true })
  getsNewTickets: boolean;

  @Column({ default: false })
  ccAll: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
