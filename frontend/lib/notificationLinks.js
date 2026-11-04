// Where a notification opens (2026-11-04). Every notification deep-links
// to its exact record. Dependency notifications saved before that fix
// still link to the Dependency Clearance list, which filters to Open and
// so hid a resolved ticket - those open the parent task's Dependency
// Tickets card instead (the ticket id was never stored, the task id is in
// the title: "Dependency on task #12 assigned to you").
export function notificationHref(item) {
  const link = item?.link || null;
  if (link === '/dependency-clearance') {
    const match = /task #(\d+)/.exec(item.title || '');
    if (match) return `/tasks/${match[1]}#dependency-tickets`;
  }
  return link;
}
