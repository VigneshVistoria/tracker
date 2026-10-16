// Project Timeline Stage C (2026-10-16) - page-side copy of
// ticketMismatches() in backend/src/project-timeline/project-timeline-
// tickets.ts (tested there). Runs on the phase's unsaved status, with the
// ticket counts from GET .../ticket-progress. Keep the two in step.

export function ticketMismatches(rowStatus, progress, linkCount) {
  if (!linkCount || !progress) return [];
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  if (progress.counted === 0) return [{ code: 'no_match', text: 'Linked, but no tickets match yet' }];
  const out = [];
  if (rowStatus === 'Completed' && progress.open > 0) out.push({ code: 'completed_open', text: `Completed, but ${n(progress.open, 'ticket')} still open` });
  if (rowStatus === 'To Do' && progress.moving > 0) out.push({ code: 'todo_moving', text: `Still To Do, but ${n(progress.moving, 'ticket')} already in review or done` });
  if ((rowStatus === 'In Progress' || rowStatus === 'Delayed') && progress.open === 0) {
    out.push({ code: 'all_done', text: `All ${n(progress.counted, 'ticket')} done - mark Completed?` });
  }
  return out;
}

// "63% · 2 of 5 done" / "No tickets yet" - one line for chips and labels.
export function progressText(progress) {
  if (!progress || progress.counted === 0) return 'No tickets yet';
  return `${progress.percent}% · ${progress.done} of ${progress.counted} done`;
}
