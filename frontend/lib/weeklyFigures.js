// Weekly figures (Programme Manager only, 2026-11-24) - text for the table,
// the week picker and each metric's evidence. Pure functions, no React.
// Mirrors backend/src/performance-tracking/scorecard/weekly-figures.service.ts
// (formatCell) so the screen and the Excel file read the same.
import { formatDateTimeEAT } from './formatDate';

// "2026-11-16" -> "16-11-2026" (a calendar day; no time zone shift).
export function dmy(day) {
  if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) return '—';
  return `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}`;
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "16-11-2026 to 22-11-2026" for the week starting that Monday.
export function weekLabel(monday) {
  return `${dmy(monday)} to ${dmy(addDays(monday, 6))}`;
}

const round1 = (n) => Math.round(n * 10) / 10;

const RATE_PER = { O3: 'tasks due', O4: 'QA rounds' };

// The value on its own ("57.7%", "3 working days", "median 21.5 h").
export function valueText(cell, unit) {
  const v = cell.value;
  if (cell.metric === 'C1') return `median ${cell.medianWorkingHours == null ? 'n/a' : `${round1(cell.medianWorkingHours)} h`}`;
  if (unit === 'percent') return `${round1(v)}%`;
  if (unit === 'days' || cell.metric === 'C2') return `${round1(v)} working ${round1(v) === 1 ? 'day' : 'days'}`;
  if (unit === 'rate') return `${round1(v)} per 10 ${RATE_PER[cell.metric] || 'items'}`;
  return String(round1(v));
}

// The second line: the counts behind it, or why there is no value.
export function detailText(cell, minSample) {
  if (cell.state === 'off') return 'not switched on';
  if (cell.state === 'na') return '';
  const parts = [];
  if (cell.metric === 'C1') parts.push(`${round1(cell.value)}% within ${cell.targetWorkingHours ?? 4} h`);
  if (cell.numerator != null && cell.denominator != null) parts.push(`${cell.numerator}/${cell.denominator}`);
  if (cell.state === 'small') parts.push(`fewer than ${minSample} items`);
  return parts.join(' · ');
}

// One line, for a screen reader or a narrow screen.
export function cellText(cell, unit, minSample) {
  if (cell.state === 'off') return 'C6 not switched on';
  if (cell.state === 'na') return 'n/a';
  const detail = detailText(cell, minSample);
  return detail ? `${valueText(cell, unit)} (${detail})` : valueText(cell, unit);
}

const task = (id, titles) => {
  const title = titles && titles[id];
  return title ? `#${id} ${title}` : `#${id}`;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const OUTCOME = { on_time: 'on time', late: 'late', short: 'left early', absent: 'absent' };

// Evidence for one metric: [{ label, items: [text] }], plain text only.
// Unknown detail keys are still shown (never silently dropped).
export function evidenceGroups(metric, details, titles = {}) {
  if (!details) return [];
  const out = [];
  const add = (label, items) => {
    if (items && items.length) out.push({ label, items });
  };
  const ids = (list) => (list || []).map((id) => task(id, titles));
  const done = new Set();
  const take = (key) => {
    done.add(key);
    return details[key];
  };

  add('Counted', ids(take('countedTaskIds')));
  switch (metric) {
    case 'D1':
      add('Late', (take('late') || []).map((l) => `${task(l.taskId, titles)} - due ${dmy(l.due)}, submitted ${dmy(l.submitted)}, ${plural(l.workingDaysLate, 'working day', 'working days')} late`));
      add('Left out (external blocker)', ids(take('leftOutExternal')));
      break;
    case 'D2':
      add('Not covered in time', (take('missed') || []).map((m) => `${task(m.taskId, titles)} - ${String(m.outcome).replace(/_/g, ' ')}${m.dueBy ? `, date due by ${dmy(m.dueBy)}` : ''}`));
      break;
    case 'D3':
      add('Slipped', ids(take('slippedTaskIds')));
      add('Warned early', ids(take('warnedTaskIds')));
      break;
    case 'D4':
      add('Moved too often', (take('tasksMovedTooOften') || []).map((m) => `${task(m.taskId, titles)} - ${plural(m.moves, 'move', 'moves')}`));
      add('Date changes', [`${take('later') ?? 0} later, ${take('earlier') ?? 0} earlier`]);
      add('Late deliveries', [`${plural(take('lateDeliveries') ?? 0, 'task', 'tasks')}, ${plural(take('slippageWorkingDays') ?? 0, 'working day', 'working days')} in total`]);
      break;
    case 'Q1':
      add('Not accepted first time', (take('notAccepted') || []).map((n) => `${task(n.taskId, titles)} - ${String(n.verdict).replace(/_/g, ' ')}`));
      break;
    case 'Q2':
      add('Failed first test', ids(take('failed')));
      break;
    case 'Q3':
      add('Reopened', ids(take('reopenedTaskIds')));
      break;
    case 'C1':
      add('Requests', (take('items') || []).map((i) => `${i.taskId ? task(i.taskId, titles) : 'Request on a task'} (${i.kind === 'dependency' ? 'dependency ticket' : 'request'}) - ${i.answered ? `answered after ${round1(i.workingHours)} working h` : `not answered, ${round1(i.workingHours)} working h so far`}`));
      take('targetWorkingHours');
      take('medianWorkingHours');
      add('Unanswered past the target', take('unanswered') ? [String(details.unanswered)] : []);
      add('Still within the target', take('waiting') ? [String(details.waiting)] : []);
      break;
    case 'C2':
      add('Tasks kept waiting', (take('blockedTasks') || []).map((b) => `${task(b.taskId, titles)} - ${plural(b.workingDays, 'working day', 'working days')}`));
      add('Overdue dependency tickets', (take('overdue') || []).map((o) => `Ticket #${o.ticketId} on ${task(o.taskId, titles)} - ${plural(o.overdueWorkingDays, 'working day', 'working days')} overdue`));
      add('Blocker flags naming them', take('blockerFlags') ? [String(details.blockerFlags)] : []);
      break;
    case 'C3':
      if (details.weeks) {
        add('Weekly report', take('weeks').map((w) => `Week of ${dmy(w.week)} - deadline ${formatDateTimeEAT(w.deadline)} - ${w.onTime ? 'on time' : w.submitted ? 'late' : 'not submitted'}`));
        take('late');
        take('missing');
      } else {
        add('Late', (take('late') || []).map((w) => `Week of ${dmy(w)}`));
        add('Not submitted', (take('missing') || []).map((w) => `Week of ${dmy(w)}`));
      }
      break;
    case 'C4':
      add('Returned as incomplete', ids(take('rejectedTaskIds')));
      break;
    case 'C5':
      add('Task-days', [`${take('freshTaskDays') ?? 0} fresh of ${take('taskDays') ?? 0}`]);
      add('Not updated in time on at least one day', ids(take('staleTaskIds')));
      break;
    case 'C6':
      add('Stand-ups', (take('meetings') || []).map((m) => `${formatDateTimeEAT(m.startAt)} - ${OUTCOME[m.outcome] || m.outcome}${m.excused ? ` (excused${m.excuseReason ? `: ${m.excuseReason}` : ''}, not counted)` : ''}`));
      break;
    case 'O1':
      take('clockStart');
      add('Blockers', (take('items') || []).map((i) => `${task(i.taskId, titles)}${i.ticketId ? `, ticket #${i.ticketId}` : ''} - raised after ${plural(i.lagWorkingDays, 'working day', 'working days')}`));
      break;
    case 'O2':
      take('maxWorkingDays');
      add('Blocked tasks', (take('items') || []).map((i) => `${task(i.taskId, titles)} - ${plural(i.ageWorkingDays, 'working day', 'working days')}${i.open ? ', still blocked' : ''}`));
      break;
    case 'O3':
      take('perTasks');
      add('Chased', ids(take('chasedTaskIds')));
      break;
    case 'O4':
      take('perTasks');
      add('Avoidable escalations', ids(take('avoidableTaskIds')));
      add('All escalations', take('escalations') ? [String(details.escalations)] : []);
      add('By reason', Object.entries(take('byReason') || {}).map(([k, n]) => `${k.replace(/_/g, ' ')}: ${n}`));
      break;
    case 'O5':
      add('Accepted', ids(take('acceptedTaskIds')));
      add('Declined', ids(take('declinedTaskIds')));
      break;
    case 'L1':
    case 'L2':
      add('Missing', ids(take('missingTaskIds')));
      break;
    default:
      break;
  }
  // Anything else the backend sent.
  for (const [key, v] of Object.entries(details)) {
    if (done.has(key) || v == null || (Array.isArray(v) && v.length === 0)) continue;
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    if (Array.isArray(v) && v.every((x) => typeof x === 'number') && /TaskIds$/.test(key)) add(label, ids(v));
    else add(label, [typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  }
  return out;
}
