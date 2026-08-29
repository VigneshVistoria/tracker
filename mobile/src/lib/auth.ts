import * as SecureStore from 'expo-secure-store';

// iOS Keychain / Android Keystore-backed, unlike the web app's
// localStorage - deliberately not repeating that known weak spot here.
const TOKEN_KEY = 'tracker_access_token';
const USER_KEY = 'tracker_user';

export interface StoredUser {
  id: number;
  email: string;
  fullName: string | null;
  role: string;
}

export async function saveSession(accessToken: string, user: StoredUser): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, accessToken);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getUser(): Promise<StoredUser | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}
