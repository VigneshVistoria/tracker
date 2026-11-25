// Requirements traceability Tree view (2026-11-25) - pure helpers for
// pages/requirements/index.js. No React. Data shape: GET
// /requirements/srs/:id/tree (backend/src/requirements/requirements.service.ts).

export const FAIL_REASON_MIN = 10;
export const AT_RISK_REASON_MIN = 10;
export const RESOLUTION_MIN = 10;

// "As a bank officer" / "As an approver".
export function aOrAn(word) {
  return /^[aeiou]/i.test(String(word || '').trim()) ? 'an' : 'a';
}

// '2026-11-16' -> '16-11-2026' (dates are DD-MM-YYYY everywhere).
export function dmy(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

// Today in the team's time zone (EAT), as YYYY-MM-DD - for date inputs.
export function todayIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const norm = (s) => String(s ?? '').toLowerCase();

// Search by requirement ID, epic, story or TRK number. Returns null when
// the query is empty (show everything), otherwise the epic ids and story
// ids to show. An epic that matches shows all its stories; a story that
// matches shows its epic. "123" and "TRK-123" both find TRK-123.
export function searchTree(epics, query) {
  const q = norm(query).trim();
  if (!q) return null;
  const epicIds = new Set();
  const storyIds = new Set();
  for (const e of epics) {
    const epicHit = [e.code, e.name, e.srsSection, `epic ${e.code}`].some((t) => norm(t).includes(q));
    for (const s of e.stories) {
      const storyHit =
        epicHit ||
        [s.code, s.title, `${s.code} ${s.title}`].some((t) => norm(t).includes(q)) ||
        s.requirements.some((r) => norm(r).includes(q)) ||
        s.tickets.some((t) => norm(t.trk).includes(q) || (/^\d+$/.test(q) && String(t.taskId) === q));
      if (storyHit) {
        storyIds.add(s.id);
        epicIds.add(e.id);
      }
    }
    if (epicHit) epicIds.add(e.id);
  }
  return { epicIds, storyIds };
}

// The label beside a story's bar. Tone: 'late' (red), 'warn' (amber),
// 'ok' (green) or '' (muted).
export function storyLabel(s) {
  switch (s.state) {
    case 'blocked':
      return { text: 'Blocked', tone: 'late' };
    case 'dependency':
      return { text: 'Waiting on dependency', tone: 'warn' };
    case 'failed':
      return { text: `${s.passed} of ${s.total} · failed`, tone: 'late' };
    case 'done':
      return { text: 'Done', tone: 'ok' };
    case 'no_tickets':
      return { text: s.status === 'draft' ? 'Draft · no tickets yet' : 'No tickets yet', tone: '' };
    default:
      return { text: `${s.passed} of ${s.total} passed`, tone: '' };
  }
}

export function resultLabel(result) {
  if (result === 'pass') return { text: 'Pass', tone: 'ok' };
  if (result === 'fail') return { text: 'Fail', tone: 'late' };
  return { text: 'Not run', tone: '' };
}

export const SRS_STATUS_LABEL = {
  draft: 'Draft',
  in_review: 'In review',
  signed_off: 'Signed off',
  client_signed_off: 'Signed off by client',
};

export const STORY_STATUS_LABEL = { draft: 'Draft', approved: 'Approved', in_progress: 'In progress', done: 'Done' };

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// Fail dialog check - same rule as the backend (trimmed, 10+ characters).
export function failReasonError(text) {
  return String(text ?? '').trim().length < FAIL_REASON_MIN ? `Please give a reason (at least ${FAIL_REASON_MIN} characters).` : '';
}

// Toast after mapping: "Linked TRK-1 (DEV) to US-02. Already linked: TRK-2 (QA)."
export function mapResultMessage(res) {
  const parts = [];
  if (res.linked?.length) parts.push(`Linked ${res.linked.join(', ')} to ${res.story}.`);
  if (res.skipped?.length) parts.push(`Already linked: ${res.skipped.join(', ')}.`);
  return parts.join(' ') || 'Nothing to link.';
}
