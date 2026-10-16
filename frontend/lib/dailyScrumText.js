// Daily Scrum "Copy as text" - plain text for pasting into Teams/email.
// Built only from the API's own lists and counts (the same ones the page
// shows), so the copy can't disagree with the screen.
import { REASON_LABELS, eventLabel } from '../components/dailyScrum/ScrumPersonView';
import { formatDate, formatDateTime, formatWeekdayDate } from './formatDate';
import { roleLabel } from './status';

// Whole days from `from` to `to` (both YYYY-MM-DD) - for "waiting N days".
export function daysBetween(from, to) {
  if (!from || !to) return 0;
  return Math.round((Date.UTC(...ymd(to)) - Date.UTC(...ymd(from))) / 86400000);
}

// "Asked today" / "Waiting 1 day" / "Waiting 5 days".
export function waitingLabel(requestedOn, today) {
  const days = daysBetween(requestedOn, today);
  if (days <= 0) return 'Asked today';
  return days === 1 ? 'Waiting 1 day' : `Waiting ${days} days`;
}

function ymd(value) {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return [y, m - 1, d];
}

function ticketLine(item) {
  const reasons = item.reasons?.length ? ` [${item.reasons.map((r) => REASON_LABELS[r] || r).join(', ')}]` : '';
  return `  - #${item.taskId} ${item.title} (${item.status}, due ${formatDate(item.dueDate)})${reasons}`;
}

function list(title, items, line, empty) {
  return [`${title} (${items.length})`, ...(items.length ? items.map(line) : [`  - ${empty}`])];
}

function header(meta) {
  const w = meta.window;
  return `Since ${formatWeekdayDate(w.lastWorkingDay)} 00:00 · Today ${formatWeekdayDate(w.today)} · ${w.timeZone.replace(/_/g, ' ')}`;
}

export function personText(person, meta, { self = true } = {}) {
  const tz = meta.window.timeZone;
  const c = person.counts;
  const lines = [
    `Daily Scrum - ${person.name} (${roleLabel(person.role)})`,
    header(meta),
    `Today ${c.today} · Blockers ${c.blockers} · With reviewers ${c.withReviewers} · Active ${c.active}`,
    '',
    ...list(
      'Since last working day',
      person.since,
      (e) => `  - ${formatDateTime(e.at, tz)} ${eventLabel(e.kind, self)}${e.detail ? ` (${e.detail})` : ''}${e.taskId != null ? ` - #${e.taskId} ${e.title}` : ''}`,
      'Nothing recorded',
    ),
    ...list('Today', person.today, ticketLine, 'None'),
    ...list('Blockers', person.blockers, ticketLine, 'None'),
    ...list('With reviewers', person.withReviewers, ticketLine, 'None'),
  ];
  if (person.waitingOnYou.length) {
    lines.push(
      ...list(
        self ? 'Others are waiting on you' : 'Others are waiting on them',
        person.waitingOnYou,
        (d) => `  - ${d.title} - for #${d.parentTaskId} ${d.parentTaskTitle} (asked by ${d.requestedByName})`,
        '',
      ),
    );
  }
  if (person.peerReviewsToDo.length) {
    lines.push(...list('Peer reviews to do', person.peerReviewsToDo, (r) => `  - #${r.taskId} ${r.title} (${r.assigneeName}, round ${r.roundNumber})`, ''));
  }
  if (person.qa) {
    const { executions: x, queue: q } = person.qa;
    lines.push(
      `QA: test cases run ${x.total} (passed ${x.passed}, failed ${x.failed}, blocked ${x.blocked}) · waiting for QA ${q.pendingQa} (resubmissions ${q.resubmissions}) · open defects raised ${q.myOpenDefects}`,
    );
  }
  return lines.join('\n');
}

export function teamText(team, externalWaits) {
  const t = team.totals;
  const today = team.window.today;
  const lines = [
    'Daily Scrum - Team',
    header(team),
    `Today ${t.today} · Blockers ${t.blockers} · With reviewers ${t.withReviewers} · Active ${t.active}${team.totalsMatch ? '' : ' · TOTALS DO NOT MATCH'}`,
    '',
    ...list('Needs your attention', team.needsAttention, (n) => `${ticketLine(n)} - ${n.name}`, 'Nothing'),
  ];
  if (externalWaits) {
    lines.push(
      ...list(
        'Waiting on the city office',
        externalWaits,
        (w) =>
          `  - ${w.title} (${w.party}, ${waitingLabel(w.requestedOn, today).toLowerCase()}${w.expectedBy ? `, expected ${formatDate(w.expectedBy)}` : ''})${w.taskId ? ` - #${w.taskId}` : ''}${w.followUpName ? ` - follow-up ${w.followUpName}` : ''}`,
        'Nothing',
      ),
    );
  }
  lines.push('', 'People');
  for (const p of team.people) {
    const c = p.counts;
    lines.push(`  - ${p.name} (${roleLabel(p.role)}): today ${c.today}, blockers ${c.blockers}, with reviewers ${c.withReviewers}, active ${c.active}`);
  }
  return lines.join('\n');
}

// navigator.clipboard needs a secure context; fall back to a hidden
// textarea + execCommand so it also works on plain http.
export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(area);
  if (!ok) throw new Error('Copy failed');
}
