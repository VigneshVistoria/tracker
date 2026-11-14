// Dependency attachments (Stage 2 screens, 2026-11-14). Mirrors
// backend/src/task-dependency-tickets/dependency-attachments.ts - the
// backend checks everything again (types from the file content).
import { apiFetch, apiUpload } from './api';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 5;
export const MAX_FILES_PER_SIDE = 10;
export const RESOLUTION_NOTE_MAX_LENGTH = 5000;
export const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'docx', 'xlsx'];
export const FILE_ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',');
export const FILE_TYPES_HINT = 'Images, PDF, Word (.docx) or Excel (.xlsx). Up to 5 files at a time, 10 MB each.';

// Why these files can't be attached, or null. `already` = files already on
// that side of the ticket.
export function checkDependencyFiles(files, already = 0) {
  if (files.length > MAX_FILES_PER_UPLOAD) return `Attach at most ${MAX_FILES_PER_UPLOAD} files at a time.`;
  if (already + files.length > MAX_FILES_PER_SIDE) return `A dependency can have at most ${MAX_FILES_PER_SIDE} files on each side.`;
  for (const file of files) {
    const ext = file.name.toLowerCase().split('.').pop();
    if (!ALLOWED_EXTENSIONS.includes(ext)) return `${file.name} is not an allowed file type.`;
    if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 10 MB.`;
    if (file.size === 0) return `${file.name} is empty.`;
  }
  return null;
}

// Same rule as dependencyAttachmentBlock() in the backend.
export function canAddDependencyFiles(ticket, side, user) {
  if (!ticket || !user) return false;
  if (side === 'request') return ticket.status === 'open' && ticket.createdByUserId === user.id;
  if (ticket.status !== 'resolved') return false;
  if (ticket.resolvedByUserId != null) return ticket.resolvedByUserId === user.id;
  return ticket.resolvedVia === 'linked_task' && ticket.ownerUserId != null && ticket.ownerUserId === user.id;
}

// Is the project's attachments switch on for this (parent) task? false if
// it can't be told.
export function loadAttachmentsEnabled(parentTaskId) {
  return apiFetch(`/task-dependency-tickets/attachments-enabled?parentTaskId=${parentTaskId}`)
    .then((r) => !!r.enabled)
    .catch(() => false);
}

export function uploadDependencyFiles(ticketId, side, files) {
  const form = new FormData();
  form.append('side', side);
  for (const file of files) form.append('files', file);
  return apiUpload(`/task-dependency-tickets/${ticketId}/attachments`, form);
}

// Resolve, with the optional note and files (switch on) in the same request.
export function resolveDependencyTicket(ticketId, { note = '', files = [] } = {}) {
  const trimmed = note.trim();
  if (files.length) {
    const form = new FormData();
    if (trimmed) form.append('note', trimmed);
    for (const file of files) form.append('files', file);
    return apiUpload(`/task-dependency-tickets/${ticketId}/resolve`, form, 'PATCH');
  }
  return apiFetch(`/task-dependency-tickets/${ticketId}/resolve`, {
    method: 'PATCH',
    ...(trimmed ? { body: JSON.stringify({ note: trimmed }) } : {}),
  });
}
