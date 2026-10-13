// The team's time zone (team_settings) and the date helpers built on it,
// shared by Daily Scrum and the QA Review summary. Pure - no Nest/TypeORM
// imports - so it can be tested with a fixed "now". Uses Node's built-in
// Intl time zone data, no library.

// What a tenant with no team_settings row uses - nothing is written until
// someone saves from Admin -> Daily Scrum Settings.
export const TEAM_SETTINGS_DEFAULTS = {
  timeZone: 'Africa/Addis_Ababa',
  workdayStart: '07:30',
  workdayEnd: '15:30',
};

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The calendar date of `instant` in `timeZone`, as YYYY-MM-DD.
export function dateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

// How far `timeZone` is ahead of UTC at `instant`, in ms.
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - (instant.getTime() - instant.getMilliseconds());
}

// The instant of 00:00 on `date` (YYYY-MM-DD) in `timeZone`. Checked a
// second time at the result, for zones that change offset (EAT doesn't).
export function startOfDayInZone(date: string, timeZone: string): Date {
  const midnightUtc = new Date(`${date}T00:00:00Z`).getTime();
  let result = midnightUtc - zoneOffsetMs(new Date(midnightUtc), timeZone);
  result = midnightUtc - zoneOffsetMs(new Date(result), timeZone);
  return new Date(result);
}
