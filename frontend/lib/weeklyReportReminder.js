// Weekly report reminder on the developer's My work (2026-11-24, the user's
// request): "Weekly report due Thursday 15:30 EAT · Submit now" until the
// report for this week is submitted. Built from GET /weekly-status (this
// week's page), so the day and time follow the deadline setting.

const ZONE_ABBR = { 'Africa/Addis_Ababa': 'EAT', 'Africa/Nairobi': 'EAT', 'Africa/Dar_es_Salaam': 'EAT', 'Africa/Kampala': 'EAT' };

// "Thursday 15:30 EAT" for the deadline instant, in the team's zone.
export function deadlineText(deadlineAt, timeZone = 'Africa/Addis_Ababa') {
  const d = new Date(deadlineAt);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.hour}:${parts.minute} ${ZONE_ABBR[timeZone] || timeZone}`;
}

// null = nothing to show (already submitted, or this person doesn't file one).
export function weeklyReportReminder(page) {
  if (!page || !page.canSubmit || page.mine) return null;
  const due = deadlineText(page.deadlineAt, page.timeZone || undefined);
  if (!due) return null;
  return page.deadlinePassed
    ? { overdue: true, text: `Weekly report overdue - it was due ${due}` }
    : { overdue: false, text: `Weekly report due ${due}` };
}
