import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// A person at a client company who uses the portal. One company per user
// (unique userId) - a client user can never belong to two clients.
@Entity('client_users')
export class ClientUser {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  clientId: number;

  @Column()
  userId: number;

  @Column({ default: false })
  isKeyContact: boolean;

  // e.g. "Finance office" - a "send to" target for team requests.
  @Column({ type: 'varchar', length: 120, nullable: true })
  department: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
