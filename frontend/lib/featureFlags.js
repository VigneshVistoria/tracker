// Task page layout v2 (2026-11-04): current actions and open items at the
// top, resolved dependencies / dependency history / older submissions
// collapsed with a count, one card per submission in Review history.
// Look and navigation only. Set to false (and deploy) to get the previous
// layout back unchanged.
export const TASK_PAGE_V2 = true;

// NEW_UI "Indigo" theme refresh (2026-11-14): indigo brand, cool grey
// backgrounds, DM Sans headings, 16px cards. Build-time switch - OFF
// unless the build sets NEXT_PUBLIC_NEW_UI=1 (only the local preview
// build does; deploy.sh never sets it). When ON, _document.js puts
// data-ui="indigo" on <html> and the tokens.css/globals.css blocks for
// that attribute apply; when OFF the site is exactly as before.
export const NEW_UI = process.env.NEXT_PUBLIC_NEW_UI === '1';

// Developer home "My work" is no longer a code flag: it is the Admin/PM
// setting "New My work screen" (Settings, /admin/my-work-screen-settings,
// default OFF) - see components/DeveloperDashboard.js.
