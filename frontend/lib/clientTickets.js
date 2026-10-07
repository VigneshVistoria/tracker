import { useEffect, useState } from 'react';
import { apiFetch } from './api';

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
