import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('teams_subscriptions')
export class TeamsSubscription {
  @PrimaryGeneratedColumn()
  id: number;

  // Microsoft's own subscription ID - needed to renew/delete it later.
  @Column()
  graphSubscriptionId: string;

  @Column()
  teamId: string;

  @Column()
  channelId: string;

  @Column({ nullable: true })
  channelName: string;

  // New tickets created from this channel land in this project.
  @Column({ nullable: true })
  projectId: number;

  // A secret we generate and send to Microsoft; every incoming webhook
  // notification must echo it back, so we can tell it's really Microsoft
  // and not someone spamming our endpoint.
  @Column()
  clientState: string;

  @Column({ type: 'timestamp' })
  expirationDateTime: Date;

  @Column({ default: true })
  active: boolean;

  @Column({ nullable: true })
  createdByUserId: number;

  @CreateDateColumn()
  createdAt: Date;
}
