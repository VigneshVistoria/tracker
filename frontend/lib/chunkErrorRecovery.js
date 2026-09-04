// Atomic deploys (scripts/build-frontend-atomic.sh) stop a build from
// ever corrupting the live site, but they can't fix a separate, ordinary
// Next.js characteristic: a browser tab already open from *before* a
// deploy still has HTML referencing the old build's buildId. Once a new
// build goes live, only its own buildId's /_next/static/ files exist -
// that old tab's own script/chunk references can still fail. This isn't
// a bug in the deploy process, just how Next.js versions its output; the
// standard fix is to detect the failure and reload, so the user sees a
// brief refresh instead of a silently broken page.
//
// Guards against a reload loop with sessionStorage: only auto-reloads
// once per tab session - if the problem persists after that, something
// else is actually wrong and repeatedly reloading would just hide it.
const RELOAD_GUARD_KEY = 'chunkErrorReloadedAt';
const RELOAD_GUARD_WINDOW_MS = 10000;

function isStaticAssetFailure(url) {
  return typeof url === 'string' && url.includes('/_next/static/');
}

function isChunkLoadError(error) {
  if (!error) return false;
  const name = error.name || '';
  const message = String(error.message || '');
  return name === 'ChunkLoadError' || /Loading chunk .* failed/i.test(message) || /Loading CSS chunk/i.test(message);
}

function reloadOnce() {
  const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
  if (Date.now() - lastReload < RELOAD_GUARD_WINDOW_MS) {
    return; // already tried reloading very recently - avoid a loop
  }
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
}

export function installChunkErrorRecovery() {
  if (typeof window === 'undefined') return () => {};

  // Failed <script>/<link> tag loads (e.g. _buildManifest.js, a CSS
  // file) - these fire a plain "error" event on the element itself,
  // which only reaches window listeners in the capture phase.
  const onResourceError = (event) => {
    const target = event.target;
    const url = target && (target.src || target.href);
    if (isStaticAssetFailure(url)) {
      reloadOnce();
    }
  };

  // Failed dynamic import() (webpack ChunkLoadError) - surfaces as an
  // unhandled promise rejection, not a resource error event.
  const onUnhandledRejection = (event) => {
    if (isChunkLoadError(event.reason)) {
      reloadOnce();
    }
  };

  window.addEventListener('error', onResourceError, true);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => {
    window.removeEventListener('error', onResourceError, true);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}
