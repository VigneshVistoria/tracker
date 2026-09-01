import Constants from 'expo-constants';
import { getToken, clearSession } from './auth';

// Same shape as the web app's apiFetch (frontend/lib/api.js) - attaches
// the bearer token automatically and throws on a non-2xx response.
const API_URL = (Constants.expoConfig?.extra?.apiUrl as string) || 'https://tracker.vistoriasystems.com/api';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// App.tsx registers this on mount so a 401 anywhere in the app (not just
// the login screen) routes back to LoginScreen immediately, instead of
// clearing the stored session but leaving the UI stuck showing a screen
// whose every subsequent request now silently 401s.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const token = await getToken();

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    // Token expired/invalid - clear it and tell the app to route back to
    // login, instead of silently failing on every subsequent call.
    await clearSession();
    onUnauthorized?.();
  }

  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new ApiError(message || 'Request failed', res.status);
  }

  return data;
}
