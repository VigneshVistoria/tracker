const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Wraps fetch, automatically attaching the saved JWT as a Bearer token.
export async function apiFetch(path, options = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(message || 'Request failed');
  }

  return data;
}

// Fetches a binary file (e.g. a PDF or an attachment) with the saved auth
// token and returns it as a Blob.
export async function apiBlob(path) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

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
export async function apiDownload(path, filename) {
  const blob = await apiBlob(path);
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
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 413) throw new Error('A file is too large. Each file can be at most 10 MB.');
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(message || 'Upload failed');
  }
  return data;
}
