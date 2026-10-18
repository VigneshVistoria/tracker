import { getAccessToken, ensureFreshToken, recoverFrom401, endSession } from './session';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Every authenticated request goes through here - the one place a 401 is
// handled. On a 401 the session is refreshed and the request retried once;
// if the session has really ended, lib/session.js signs the tab out with a
// friendly message and this returns a promise that never settles, so no
// page ever shows a raw "Invalid or expired token" error underneath.
async function authedFetch(path, init, headers = {}) {
  await ensureFreshToken();
  const send = () => {
    const token = getAccessToken();
    return fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
    });
  };
  let res = await send();
  if (res.status !== 401) return res;
  if (await recoverFrom401()) {
    res = await send();
    if (res.status !== 401) return res;
    endSession('expired');
  }
  return new Promise(() => {});
}

// Wraps fetch, automatically attaching the saved JWT as a Bearer token.
export async function apiFetch(path, options = {}) {
  const res = await authedFetch(path, options, { 'Content-Type': 'application/json' });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(message || 'Request failed');
  }

  return data;
}

// Fetches a binary file (e.g. a PDF or an attachment) with the saved auth
// token and returns it as a Blob. `body` (optional) is sent as a JSON POST,
// for files built from a request (e.g. the Project Timeline export).
export async function apiBlob(path, body) {
  const res = await authedFetch(
    path,
    body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {},
    body !== undefined ? { 'Content-Type': 'application/json' } : {},
  );

  if (!res.ok) {
    let message = 'Download failed';
    try {
      const data = await res.json();
      message = Array.isArray(data.message) ? data.message.join(', ') : data.message || message;
    } catch (_) {
      // Response wasn't JSON (e.g. an empty body) - fall back to the generic message above.
    }
    throw new Error(message);
  }

  return res.blob();
}

// Like apiFetch, but for endpoints that return a binary file (e.g. a PDF)
// rather than JSON. Fetches it with the saved auth token, then triggers a
// normal browser "Save As" download using a throwaway <a> element - no
// server round trip needed beyond the one fetch, and nothing is left
// behind in the DOM or in memory afterwards.
export async function apiDownload(path, filename, body) {
  const blob = await apiBlob(path, body);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// Multipart upload (FormData). The browser sets the multipart Content-Type
// itself, so unlike apiFetch no JSON header is sent.
export async function apiUpload(path, formData) {
  const res = await authedFetch(path, { method: 'POST', body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 413) throw new Error('A file is too large. Each file can be at most 10 MB.');
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(message || 'Upload failed');
  }
  return data;
}
