// GitHub PR helpers (2026-11-11) - the text Tracker hands a developer so
// they never type a task ID by hand. Settings come from
// GET /github-releases/pr-helper (backend/src/github-releases). Tracker
// never writes to GitHub: "Open pull request" is a link to GitHub's own
// new-PR page, and the developer still presses Create.

const SLUG_MAX = 40;
const TITLE_MAX = 250;

// "Fix login timeout (SSO)" -> "fix-login-timeout-sso", cut at a word.
export function slugify(title) {
  const s = String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length <= SLUG_MAX) return s;
  const cut = s.slice(0, SLUG_MAX);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 10 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

// feature/TRK-255-fix-login-timeout
export function branchName(branchPrefix, keyPrefix, taskId, title) {
  const slug = slugify(title);
  return `${branchPrefix}${keyPrefix}-${taskId}${slug ? `-${slug}` : ''}`;
}

// TRK-255 Fix login timeout
export function prTitle(keyPrefix, taskId, title) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  return `${keyPrefix}-${taskId} ${clean}`.trim().slice(0, TITLE_MAX);
}

// GitHub's new-PR page for the branch against the repository's default
// branch, with the title filled in. The branch must already be pushed.
export function newPullRequestUrl(repoFullName, branch, title) {
  const head = branch.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repoFullName}/compare/${head}?expand=1&title=${encodeURIComponent(title)}`;
}
