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
