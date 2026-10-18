import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

// One web sign-in (see migrations/2026-10-refresh-sessions.sql). The
// refresh token itself only ever lives in the browser's httpOnly cookie -
// this row holds its SHA-256 hash.
@Entity('refresh_sessions')
export class RefreshSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  userId: number;

  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  // The token this one replaced - still accepted for a few seconds after
  // rotatedAt (two tabs refreshing at once); a reuse after that revokes.
  @Column({ type: 'varchar', length: 64, nullable: true })
  previousTokenHash: string | null;

  @Column({ type: 'timestamp', nullable: true })
  rotatedAt: Date | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  lastUsedAt: Date;

  // Idle limit - pushed forward on every refresh, never past absoluteExpiresAt.
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp' })
  absoluteExpiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  revokedReason: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  userAgent: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
