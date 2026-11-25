import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { SrsStatus } from '../requirements';

// Requirements traceability (migrations/2026-11-requirements-s1.sql): one
// SRS per project and version. lineageId links the versions of one SRS
// (Stage 4); null until a second version exists. Soft-deleted only.
@Entity('srs_documents')
export class SrsDocument {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  projectId: number;

  @Column({ type: 'int', nullable: true })
  lineageId: number | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  version: string;

  @Column({ type: 'date', nullable: true })
  issuedOn: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  reviewerUserIds: number[];

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: SrsStatus;

  @Column({ type: 'int', nullable: true })
  signedOffByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  signedOffAt: Date | null;

  // Client sign-off (Stage 2): recorded by the PM only; the signed document
  // is in storage under clientFileKey. Required by the database when status
  // is 'client_signed_off'.
  @Column({ type: 'varchar', length: 255, nullable: true })
  clientName: string | null;

  @Column({ type: 'date', nullable: true })
  clientSignedOn: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  clientFileKey: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  clientFileName: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  clientFileMime: string | null;

  @Column({ type: 'int', nullable: true })
  clientFileSize: number | null;

  @Column({ type: 'int', nullable: true })
  clientSignedByUserId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  clientSignedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  createdByUserId: number | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'now()' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;
}
