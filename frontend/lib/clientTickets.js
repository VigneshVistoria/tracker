import { useEffect, useState } from 'react';
import { apiFetch, apiUpload } from './api';

// Client portal tickets (Stage 2) - labels and wording shared by the
// client screens (/portal) and the team screens (/client-tickets). Values
// match backend/src/client-portal/client-ticket.entity.ts.

export const CATEGORIES = [
  { value: 'bug', label: 'Bug / Defect', hint: 'Something is broken or gives a wrong result' },
  { value: 'change_request', label: 'Change request', hint: 'Change how something works' },
  { value: 'question', label: 'Question', hint: 'Ask how to do something' },
  { value: 'support', label: 'Support', hint: 'Access, data or account help' },
];

// Response targets are shown as text only - no timers until the SLA times
// are agreed (decided with the user 2026-10-07).
export const SEVERITIES = [
  { value: 'showstopper', label: 'Showstopper', hint: 'System down or blocked. No workaround.', target: 'Response within 1 hour', tone: 'error' },
  { value: 'critical', label: 'Critical', hint: 'Key feature broken, poor workaround.', target: 'Response within 4 hours', tone: 'error' },
  { value: 'major', label: 'Major', hint: 'Feature partly broken, workaround exists.', target: 'Response within 1 day', tone: 'warning' },
  { value: 'minor', label: 'Minor', hint: 'Cosmetic or small issue.', target: 'Response within 3 days', tone: 'neutral' },
];

export const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

// `client` is the wording client users see, `team` what the team sees.
export const STATUSES = {
  submitted: { client: 'Submitted', team: 'New', tone: 'info', step: 0 },
  in_progress: { client: 'In progress', team: 'In progress', tone: 'info', step: 1 },
  waiting_client: { client: 'Waiting for you', team: 'Waiting on client', tone: 'warning', step: 1 },
  client_review: { client: 'Ready for your review', team: 'Client reviewing', tone: 'warning', step: 2 },
  closed: { client: 'Closed', team: 'Closed', tone: 'success', step: 3 },
};

// What the team can move a ticket to in Stage 2 (backend TEAM_SETTABLE_STATUSES).
export const TEAM_STATUS_OPTIONS = ['in_progress', 'client_review', 'closed'];

export const STEPS = ['Submitted', 'In progress', 'Resolved', 'Closed'];

const byValue = (list) => Object.fromEntries(list.map((item) => [item.value, item]));
export const CATEGORY_BY_VALUE = byValue(CATEGORIES);
export const SEVERITY_BY_VALUE = byValue(SEVERITIES);
export const PRIORITY_BY_VALUE = byValue(PRIORITIES);

export const isOpen = (ticket) => ticket.status !== 'closed';

// Attachments (Stage 3) - same limits the backend enforces
// (backend/src/client-portal/attachment-types.ts); checked here first only
// so people get the message before uploading.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 5;
export const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'csv', 'docx', 'xlsx', 'pptx'];
export const FILE_ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',');
export const FILE_TYPES_HINT = 'Images, PDF, TXT, CSV, Word, Excel or PowerPoint. Up to 5 files, 10 MB each.';

export function checkFiles(files) {
  if (files.length > MAX_FILES) return `Attach at most ${MAX_FILES} files at a time.`;
  for (const file of files) {
    const ext = file.name.toLowerCase().split('.').pop();
    if (!ALLOWED_EXTENSIONS.includes(ext)) return `${file.name} is not an allowed file type.`;
    if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 10 MB.`;
    if (file.size === 0) return `${file.name} is empty.`;
  }
  return null;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const isImage = (mimeType) => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType);

// Posts a reply, then its files (attached to that reply). Returns the
// updated ticket. If only the files fail, the error says so and carries
// `replySent` so the form doesn't send the text again.
export async function postReply(ticketId, { body, isInternal = false, files = [] }, viewerId) {
  const ticket = await apiFetch(`/client-portal/tickets/${ticketId}/comments`, {
    method: 'POST',
    body: JSON.stringify(isInternal ? { body, isInternal } : { body }),
  });
  if (files.length === 0) return ticket;
  const mine = ticket.comments.filter((c) => c.authorUserId === viewerId);
  const reply = mine[mine.length - 1];
  try {
    return await uploadTicketFiles(ticketId, files, reply?.id);
  } catch (err) {
    const error = new Error(`Your reply was sent, but the files were not attached: ${err.message}`);
    error.replySent = true;
    error.ticket = ticket;
    throw error;
  }
}

// Uploads files to a ticket (optionally to the caller's own reply) and
// returns the updated ticket.
export function uploadTicketFiles(ticketId, files, commentId) {
  const form = new FormData();
  if (commentId) form.append('commentId', String(commentId));
  for (const file of files) form.append('files', file);
  return apiUpload(`/client-portal/tickets/${ticketId}/attachments`, form);
}

// GET /client-portal/me, shared across the pages of one visit. Cached per
// login token, so logging in as someone else or impersonating never
// reuses another user's answer. Resolves to
// { portalClient, teamClients, canSeeClientTickets }.
let cache = { token: null, promise: null };
export function loadPortalMe() {
  const token = localStorage.getItem('accessToken');
  if (!cache.promise || cache.token !== token) {
    const promise = apiFetch('/client-portal/me').catch((err) => {
      if (cache.promise === promise) cache = { token: null, promise: null };
      throw err;
    });
    cache = { token, promise };
  }
  return cache.promise;
}

export function resetPortalMe() {
  cache = { token: null, promise: null };
}

export function usePortalMe() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!localStorage.getItem('accessToken')) return undefined;
    loadPortalMe()
      .then((value) => !cancelled && setMe(value))
      .catch(() => !cancelled && setMe({ portalClient: null, teamClients: [], canSeeClientTickets: false }));
    return () => {
      cancelled = true;
    };
  }, []);
  return me;
}
