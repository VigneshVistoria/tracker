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

  // PM review gate reminders (2026-10-13): a ticket waiting for the PM
  // longer than this many working days reminds the PMs, and at twice that
  // the Admins too when pmReminderToAdmin is on.
  @Column({ type: 'int', default: 2 })
  pmReminderWorkingDays: number;

  @Column({ default: true })
  pmReminderToAdmin: boolean;

  // QA Reject as "Not ready for testing" (2026-10-27): the reasons QA picks
  // from, edited by Admin and Program Manager from Admin -> QA Review
  // Settings. No row, or an empty list (never saved), means
  // DEFAULT_QA_NOT_READY_REASONS (tasks/qa-not-ready.ts); saving needs at
  // least one reason.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  qaNotReadyReasons: string[];

  // Defect classification + triage (2026-10-27): the editable lists and
  // rules (severities, types, origins, environments, dispute reasons,
  // required fields, triage working days), edited by Admin and Program
  // Manager from Admin -> Defect Triage Settings. '{}' (never saved) or any
  // missing key means DEFAULT_DEFECT_TRIAGE_SETTINGS
  // (tasks/defect-triage.ts, resolveDefectTriageSettings()).
  @Column({ type: 'jsonb', default: () => "'{}'" })
  defectTriageSettings: Record<string, unknown>;

  // Developer submission checklist (2026-10-27): root causes, which items
  // are required per kind, which artifact types count as link / evidence,
  // minimum text length. '{}' or a missing key means the defaults
  // (tasks/submission-checklist.ts, resolveSubmissionChecklistSettings()).
  @Column({ type: 'jsonb', default: () => "'{}'" })
  submissionChecklistSettings: Record<string, unknown>;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'int', nullable: true })
  updatedByUserId: number | null;
}
