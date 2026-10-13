import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// One row per tenant (migrations/2026-10-daily-scrum-settings.sql) - the
// team's time zone for Daily Scrum's "today" and "since last working day"
// window, plus working hours that are shown for information only and never
// cut that window (confirmed with the user 2026-10-12). Edited by Admin and
// Program Manager from Admin -> Daily Scrum Settings. A tenant with no row
// uses TEAM_SETTINGS_DEFAULTS (time-zone.ts) - nothing is written
// until someone saves.
@Entity('team_settings')
export class TeamSettings {
  @PrimaryColumn()
  tenantId: number;

  // IANA zone name, e.g. 'Africa/Addis_Ababa' - checked with
  // isValidTimeZone() before it's saved.
  @Column({ default: 'Africa/Addis_Ababa' })
  timeZone: string;

  // 'HH:MM', display only.
  @Column({ type: 'varchar', length: 5, default: '07:30' })
  workdayStart: string;

  @Column({ type: 'varchar', length: 5, default: '15:30' })
  workdayEnd: string;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'int', nullable: true })
  updatedByUserId: number | null;
}
