import { disconnectSocket, setSocketRejectedHandler } from './socket';

// Web sign-in session (2026-10-18). The page holds a short-lived access
// token (15 min) in localStorage; the backend keeps the long-lived refresh
// token in an httpOnly cookie that scripts can't read. This module:
//  - refreshes the access token quietly before it runs out (and on wake /
//    tab focus), so an open page - including a wall display - stays
//    signed in for as long as the session lasts;
//  - when the session really has ended, signs the tab out cleanly and
//    sends the user to sign-in with a friendly message, returning them to
//    the exact page (path + filters) afterwards;
//  - keeps every open tab consistent: one tab refreshes at a time (Web
//    Locks), and a sign-out or user switch in one tab is picked up by the
//    others through the localStorage "storage" event.

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const LOCK_NAME = 'tracker-session-refresh';
const RETURN_TO_KEY = 'tracker.returnTo';
const NOTICE_KEY = 'tracker.signInNotice';
const END_REASON_KEY = 'tracker.sessionEndReason';
const UPGRADE_TRIED_KEY = 'tracker.sessionUpgradeTried';
// Refresh once 80% of the token's life has passed.
const REFRESH_AT = 0.8;
// Tokens this short come from a web session; longer ones are the old
// 1-day tokens (or the mobile/API kind) and have no refresh cookie.
const WEB_TOKEN_MAX_LIFETIME_S = 60 * 60;
// Someone who touched the page this recently is "using it": an expired
// session sends them straight to sign-in. Otherwise (a wall display, a
// tab left open) a calm "Session ended" panel waits for a click.
const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

export const SESSION_EXPIRED_NOTICE = 'Your session expired, please sign in again.';

let refreshPromise = null;
let timer = null;
let retryDelay = 0;
let ended = null; // { reason, prompt } once this tab's session has ended
let lastInteraction = Date.now();
let installed = false;
let lastSocketRetry = 0;
const listeners = new Set();

export const webClientHeaders = { 'X-Client': 'web' };

export function getAccessToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
}

function decode(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}

const isImpersonating = () => !!localStorage.getItem('impersonator');
const isWebToken = (p) => !!(p && p.exp && p.iat && p.exp - p.iat <= WEB_TOKEN_MAX_LIFETIME_S);
const secondsLeft = (p) => (p && p.exp ? p.exp - Date.now() / 1000 : -1);

function storedUserId() {
  try {
    return JSON.parse(localStorage.getItem('user'))?.id ?? null;
  } catch {
    return null;
  }
}

// --- state the "Session ended" panel listens to -------------------------

export function subscribeSession(listener) {
  listeners.add(listener);
  listener(ended);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((l) => l(ended));
}

// --- storing / refreshing ------------------------------------------------

// Saves a token (+ user) after sign-in, refresh, or impersonation start,
// and re-plans the next quiet refresh.
export function storeSession({ accessToken, user }) {
  localStorage.setItem('accessToken', accessToken);
  if (user) localStorage.setItem('user', JSON.stringify(user));
  localStorage.removeItem(END_REASON_KEY);
  ended = null;
  notify();
  schedule();
}

// Resolves to 'ok' (a fresh token is stored), 'ended' (the server says
// the session is over) or 'offline' (couldn't tell - network / server
// trouble; never treated as signed out). One refresh per tab at a time,
// and one across all tabs via the Web Locks API.
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = runRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function runRefresh() {
  const startToken = getAccessToken();
  const work = async () => {
    // Another tab may have refreshed while this one waited for the lock -
    // the new token is already in localStorage, so just use it.
    const current = getAccessToken();
    if (current && current !== startToken && secondsLeft(decode(current)) > 60) {
      schedule();
      return 'ok';
    }
    let res;
    try {
      res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include', headers: webClientHeaders });
    } catch {
      return 'offline';
    }
    if (res.status === 401) return 'ended';
    if (!res.ok) return 'offline';
    const data = await res.json().catch(() => null);
    if (!data?.accessToken) return 'offline';
    applyRefreshed(data);
    return 'ok';
  };
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(LOCK_NAME, work);
  }
  return work();
}

function applyRefreshed(data) {
  const previousId = storedUserId();
  // A refresh always comes back as the cookie's owner. While impersonating
  // that's the admin, so the impersonation has run out - go back to the
  // admin's own view cleanly.
  if (isImpersonating()) {
    localStorage.removeItem('impersonator');
    storeSession(data);
    disconnectSocket();
    window.location.assign('/admin/users');
    return;
  }
  storeSession(data);
  if (previousId !== null && data.user && data.user.id !== previousId) {
    // A different person signed in on this browser in the meantime.
    window.location.reload();
    return;
  }
  // Role or name changes show up in the shell straight away.
  window.dispatchEvent(new CustomEvent('tracker:user-updated', { detail: data.user }));
}

// If the current token is a web token that has already run out (laptop
// asleep, background tab throttled), refresh before sending a request
// that would only bounce.
export async function ensureFreshToken() {
  const token = getAccessToken();
  if (!token || isImpersonating()) return;
  const p = decode(token);
  if (isWebToken(p) && secondsLeft(p) < 5) await refreshSession();
}

// Called by the API helpers on a 401. Resolves to true if the request is
// worth retrying with a new token; false = session over (already handled).
// Throws when the server can't be reached, so the page shows a normal
// "try again" error instead of signing anyone out.
export async function recoverFrom401() {
  if (ended) return false;
  const result = await refreshSession();
  if (result === 'ok') return true;
  if (result === 'offline') throw new Error("Can't reach the server right now. Please try again in a moment.");
  endSession('expired');
  return false;
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  const token = getAccessToken();
  const p = token ? decode(token) : null;
  // Impersonation tokens aren't refreshed (a refresh returns the admin) -
  // they simply end, see applyRefreshed.
  if (!isWebToken(p) || isImpersonating()) return;
  const lifetimeMs = (p.exp - p.iat) * 1000;
  // A little jitter so many tabs don't all line up on the same second.
  const dueAt = p.iat * 1000 + lifetimeMs * REFRESH_AT + Math.random() * 5000;
  timer = setTimeout(timedRefresh, Math.max(1000, dueAt - Date.now()));
}

async function timedRefresh() {
  const result = await refreshSession();
  if (result === 'ok') {
    retryDelay = 0;
  } else if (result === 'ended') {
    endSession('expired');
  } else {
    // Offline or server trouble: keep trying, backing off to 2 minutes.
    retryDelay = Math.min(retryDelay ? retryDelay * 2 : 10_000, 120_000);
    clearTimeout(timer);
    timer = setTimeout(timedRefresh, retryDelay);
  }
}

// Wake from sleep, tab brought back, network back: catch up at once
// instead of waiting for a (possibly throttled) timer.
function checkNow() {
  if (ended || isImpersonating()) return;
  const p = decode(getAccessToken() || '');
  if (isWebToken(p) && secondsLeft(p) < (p.exp - p.iat) * (1 - REFRESH_AT)) timedRefresh();
}

// --- ending the session --------------------------------------------------

function currentPath() {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

// Only same-app paths are ever used as a return address ("/x", never
// "//evil.example" or "https://...").
export function safeReturnPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
  if (path === '/' || path.startsWith('/?') || path.startsWith('/register')) return null;
  return path;
}

function signInUrl(returnTo) {
  const next = safeReturnPath(returnTo);
  return next ? `/?next=${encodeURIComponent(next)}` : '/';
}

function clearStoredSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('user');
  localStorage.removeItem('impersonator');
  disconnectSocket();
  clearTimeout(timer);
  timer = null;
}

// The session is over (refresh refused, or another tab found that out).
// Recently-active users go straight to sign-in with the friendly notice;
// an idle page shows the calm "Session ended" panel and waits.
export function endSession(reason, { fromOtherTab = false } = {}) {
  if (ended) return;
  if (!fromOtherTab) localStorage.setItem(END_REASON_KEY, reason);
  clearStoredSession();
  const returnTo = currentPath();
  sessionStorage.setItem(RETURN_TO_KEY, returnTo);
  sessionStorage.setItem(NOTICE_KEY, SESSION_EXPIRED_NOTICE);
  const active = document.visibilityState === 'visible' && Date.now() - lastInteraction < ACTIVE_WINDOW_MS;
  ended = { reason, prompt: !active };
  notify();
  if (active) window.location.assign(signInUrl(returnTo));
}

// The "Continue" button on the Session ended panel.
export function continueToSignIn() {
  window.location.assign(signInUrl(sessionStorage.getItem(RETURN_TO_KEY) || currentPath()));
}

// Explicit "Log out": ends the session on the server too, then tells the
// other tabs (via the storage event) to follow.
export async function signOut() {
  localStorage.setItem(END_REASON_KEY, 'logout');
  clearStoredSession();
  sessionStorage.removeItem(RETURN_TO_KEY);
  try {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include', headers: webClientHeaders, keepalive: true });
  } catch {
    // Offline - the cookie still expires on its own; the tab is signed out regardless.
  }
}

// For pages that find no signed-in user at all: go to sign-in, coming
// back here afterwards.
export function redirectToSignIn(router) {
  const next = safeReturnPath(router?.asPath || currentPath());
  router.replace(next ? { pathname: '/', query: { next } } : '/');
}

// Login page: where to go after signing in, and the notice to show.
export function takeReturnPath(queryNext) {
  const fromQuery = safeReturnPath(Array.isArray(queryNext) ? queryNext[0] : queryNext);
  const stored = safeReturnPath(sessionStorage.getItem(RETURN_TO_KEY));
  sessionStorage.removeItem(RETURN_TO_KEY);
  return fromQuery || stored;
}

export function takeSignInNotice() {
  const notice = sessionStorage.getItem(NOTICE_KEY);
  sessionStorage.removeItem(NOTICE_KEY);
  return notice;
}

// --- install (once, from _app) -------------------------------------------

// Sign-ins from before web sessions have a 1-day token and no cookie. Swap
// it once for a session so the change signs nobody out (backend only
// allows this for a day after the deploy).
async function upgradeLegacySession() {
  const token = getAccessToken();
  const p = token ? decode(token) : null;
  if (!p || isWebToken(p) || isImpersonating() || secondsLeft(p) < 30) return;
  if (localStorage.getItem(UPGRADE_TRIED_KEY) === token.slice(-24)) return;
  const work = async () => {
    if (getAccessToken() !== token) return; // another tab already did it
    localStorage.setItem(UPGRADE_TRIED_KEY, token.slice(-24));
    try {
      const res = await fetch(`${API_URL}/auth/session-upgrade`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...webClientHeaders, Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.accessToken && getAccessToken() === token) storeSession(data);
    } catch {
      // Not available - the old token simply runs its course.
    }
  };
  if (navigator.locks?.request) await navigator.locks.request(LOCK_NAME, work);
  else await work();
}

function onStorage(e) {
  if (e.storageArea !== localStorage) return;
  if (e.key === 'accessToken' || e.key === null) {
    if (!e.newValue) {
      // Signed out in another tab.
      if (ended) return;
      const reason = localStorage.getItem(END_REASON_KEY);
      if (reason === 'logout') {
        clearStoredSession();
        window.location.assign('/');
      } else if (window.location.pathname !== '/') {
        endSession(reason || 'expired', { fromOtherTab: true });
      }
      return;
    }
    // Signed back in in another tab: this tab's requests were halted
    // when it ended, so start the page afresh with the new session.
    if (ended) {
      window.location.reload();
      return;
    }
    // Another tab refreshed: use its token.
    schedule();
  } else if (e.key === 'user' && e.newValue) {
    let next = null;
    try {
      next = JSON.parse(e.newValue);
    } catch {
      return;
    }
    const prev = e.oldValue ? JSON.parse(e.oldValue) : null;
    if (prev && next && prev.id !== next.id) {
      // A different person (or an impersonation start/end) in another
      // tab: reload so this tab never mixes two users' data.
      window.location.reload();
    } else {
      window.dispatchEvent(new CustomEvent('tracker:user-updated', { detail: next }));
    }
  }
}

function onSocketRejected(socket) {
  // The live-updates socket was refused (expired token at reconnect):
  // refresh, then reconnect - at most every 30 s.
  if (ended || Date.now() - lastSocketRetry < 30_000) return;
  lastSocketRetry = Date.now();
  refreshSession().then((result) => {
    if (result === 'ok') socket.connect();
    else if (result === 'ended') endSession('expired');
  });
}

export function installSessionKeeper() {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  const markActive = () => {
    lastInteraction = Date.now();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') checkNow();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('pointerdown', markActive, { passive: true, capture: true });
  window.addEventListener('keydown', markActive, { capture: true });
  window.addEventListener('focus', checkNow);
  window.addEventListener('online', checkNow);
  document.addEventListener('visibilitychange', onVisible);
  setSocketRejectedHandler(onSocketRejected);
  schedule();
  checkNow();
  upgradeLegacySession();
  return () => {
    installed = false;
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pointerdown', markActive, { capture: true });
    window.removeEventListener('keydown', markActive, { capture: true });
    window.removeEventListener('focus', checkNow);
    window.removeEventListener('online', checkNow);
    document.removeEventListener('visibilitychange', onVisible);
    setSocketRejectedHandler(null);
    clearTimeout(timer);
  };
}
