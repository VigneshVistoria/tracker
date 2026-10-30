// Performance Tracking P1/P2 (2026-10-30, fast-track) - the release path
// and change ticket, entered by hand on a Release Log entry because CI/CD
// webhooks are blocked. Pure - no Nest/TypeORM imports.
//  * Released by: a Developer, Designer or DevOps account; P1 and P2 are
//    charged to them. A release with nobody set is charged to nobody.
//  * Staging sign-off: a date plus who signed off (both or neither), by
//    any staff account other than the person who released.
//  * P1 counts a release as on the path when it was signed off on staging
//    on or before its release date; a later sign-off is recorded but does
//    not count. P2 counts a release with a change ticket.
import { UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../users/user.entity';

export interface ReleasePathFields {
  releasedByUserId: number | null;
  stagingSignedOffOn: string | null;
  stagingSignedOffByUserId: number | null;
  changeTicketRef: string | null;
}

export const RELEASED_BY_ROLES: UserRole[] = DEVELOPER_EQUIVALENT_ROLES;

export function releasePathProblem(
  r: ReleasePathFields,
  roleOf: (userId: number) => UserRole | undefined,
): string | null {
  if (r.releasedByUserId !== null) {
    const role = roleOf(r.releasedByUserId);
    if (!role || !RELEASED_BY_ROLES.includes(role)) return 'Released by must be a Developer, Designer or DevOps account.';
  }
  if ((r.stagingSignedOffOn === null) !== (r.stagingSignedOffByUserId === null)) {
    return 'Enter both the staging sign-off date and who signed off, or neither.';
  }
  if (r.stagingSignedOffByUserId !== null) {
    const role = roleOf(r.stagingSignedOffByUserId);
    if (!role || role === UserRole.CLIENT) return 'Staging sign-off must be by a staff account.';
    if (r.stagingSignedOffByUserId === r.releasedByUserId) return 'The person who released cannot sign off their own release on staging.';
  }
  return null;
}

export const onReleasePath = (r: { releaseDate: string; stagingSignedOffOn: string | null }) =>
  r.stagingSignedOffOn !== null && r.stagingSignedOffOn <= r.releaseDate;

export const hasChangeTicket = (r: { changeTicketRef: string | null }) => !!r.changeTicketRef && r.changeTicketRef.trim() !== '';
