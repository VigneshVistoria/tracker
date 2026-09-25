// Business-day math for the QA Review Due Date feature (ProjectTask.
// qaReviewDueDate) - the only date-arithmetic feature in this codebase
// that needs to skip weekends. The Issue SLA due-soon feature
// (sla.service.ts) is deliberately plain wall-clock hours, not a
// precedent to follow here. No company holiday calendar is involved by
// design - Saturday/Sunday are the only non-business days recognized.
//
// All arithmetic is done in UTC calendar terms (not the server's local
// timezone) so the result is stable regardless of where this process
// runs - the same convention TasksService.findTeam() already uses for
// "today" (`new Date().toISOString().slice(0, 10)`).

// Adds `days` business days to `from`. `from` itself is never counted -
// it's the moment being measured from (e.g. a QA submission timestamp),
// not a business day being consumed - so a Thursday submission + 5
// business days lands on the *following* Thursday: Fri, Mon, Tue, Wed,
// Thu (Sat/Sun skipped, not counted).
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const dayOfWeek = result.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      remaining -= 1;
    }
  }
  return result;
}

// ProjectTask.qaReviewDueDate/dueDate are both plain `date` columns
// (YYYY-MM-DD, no time component) - this formats an addBusinessDays()
// result to match.
export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
