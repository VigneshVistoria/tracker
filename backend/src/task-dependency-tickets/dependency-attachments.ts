// Dependency attachments (feature request from Salman 2026-11-02, decisions
// from the user 2026-11-13). Pure - no Nest/TypeORM imports.
//
// On a project with Project.dependencyAttachmentsEnabled ON (default OFF;
// Admin or Program Manager switches it - separate from Dependency tasks):
//  * The requester attaches files to the ticket while it is open
//    ('request' side) - normally right after raising it.
//  * Resolve takes an optional resolution note and files ('resolution'
//    side), uploaded with the Resolve itself (all-or-nothing). Whoever
//    resolved it may add more resolution files afterwards (a retry); for a
//    ticket resolved through its dependency task, the ticket owner may.
//  * Images, PDF, Word (.docx) and Excel (.xlsx) only, type checked from the
//    content; 10 MB each, 5 per upload, 10 per side. Nothing is deleted.
//  * Seen and downloaded by whoever can see the ticket (the parent task's
//    viewers, the owner, the requester, the dependency task's viewers).
// With the switch OFF nothing new can be attached and Resolve takes no
// note; files already attached stay visible.
// Who resolved a ticket and when is recorded whatever the switch.
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BYTES } from '../client-portal/attachment-types';
import { UserRole } from '../users/user.entity';

export const DEPENDENCY_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
export const DEPENDENCY_ATTACHMENT_TYPES_LABEL = 'images (PNG, JPEG, WebP, GIF), PDF, Word (.docx) or Excel (.xlsx)';
export const DEPENDENCY_ATTACHMENT_MAX_BYTES = MAX_ATTACHMENT_BYTES;
export const DEPENDENCY_ATTACHMENTS_PER_UPLOAD = MAX_ATTACHMENTS_PER_UPLOAD;
export const DEPENDENCY_ATTACHMENTS_PER_SIDE = 10;
export const DEPENDENCY_RESOLUTION_NOTE_MAX_LENGTH = 5000;

export type DependencyAttachmentSide = 'request' | 'resolution';
export const DEPENDENCY_ATTACHMENT_SIDES: DependencyAttachmentSide[] = ['request', 'resolution'];

export const DEPENDENCY_ATTACHMENTS_SWITCH_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER];

export const DEPENDENCY_ATTACHMENT_AUDIT = {
  PROJECT_SWITCHED: 'dependency_attachments_project_switched',
  FILES_ATTACHED: 'task_dependency_ticket_files_attached',
} as const;

interface TicketForAttachments {
  status: 'open' | 'resolved' | 'cancelled';
  createdByUserId: number | null;
  ownerUserId: number | null;
  resolvedByUserId: number | null;
  resolvedVia: 'ticket' | 'linked_task' | null;
}

// Why this user can't attach files to this side of the ticket, or null.
export function dependencyAttachmentBlock(ticket: TicketForAttachments, side: DependencyAttachmentSide, user: { id: number }): string | null {
  if (side === 'request') {
    if (ticket.createdByUserId !== user.id) return 'Only whoever raised this dependency can attach files to the request.';
    if (ticket.status !== 'open') return `Request files can only be added while the dependency is open - this one is ${ticket.status}.`;
    return null;
  }
  if (ticket.status !== 'resolved') return 'Resolution files are added with Resolve - this dependency is not resolved.';
  const resolver =
    ticket.resolvedByUserId != null
      ? ticket.resolvedByUserId === user.id
      : ticket.resolvedVia === 'linked_task' && ticket.ownerUserId != null && ticket.ownerUserId === user.id;
  if (!resolver) return 'Only whoever resolved this dependency can add resolution files.';
  return null;
}

// The system note shown on a ticket its dependency task resolved
// (user decision 2026-11-13). actorName null = no person on record.
export function autoResolvedNote(actorName: string | null, date: string): string {
  return `Auto-resolved: linked task closed by ${actorName ?? 'the system'} on ${date}`;
}
