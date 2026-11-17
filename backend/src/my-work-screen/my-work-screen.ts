// "New My work screen" setting (2026-11-17, user request) - replaces the
// DEV_MY_WORK code flag. Admin/PM switch it On/Off for everyone, plus
// optional pilot users who get it while it is Off. DEFAULT OFF: Developer,
// Designer and DevOps keep the old dashboard. Audited. Pure - no Nest.
import { UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../users/user.entity';

export const MY_WORK_SCREEN_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];
// Who the screen is for (the developer home).
export const MY_WORK_SCREEN_USER_ROLES: UserRole[] = DEVELOPER_EQUIVALENT_ROLES;
export const MY_WORK_SCREEN_AUDIT = { UPDATED: 'my_work_screen_updated' } as const;
export const PILOT_USERS_MAX = 50;

export interface MyWorkScreenSettings {
  enabled: boolean;
  pilotUserIds: number[];
}

export function resolveMyWorkScreen(stored: unknown): MyWorkScreenSettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const ids = Array.isArray(s.pilotUserIds) ? s.pilotUserIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  return { enabled: s.enabled === true, pilotUserIds: [...new Set(ids)] };
}

export function myWorkScreenOnFor(settings: MyWorkScreenSettings, userId: number): boolean {
  return settings.enabled || settings.pilotUserIds.includes(userId);
}
