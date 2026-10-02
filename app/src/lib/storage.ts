// Native session storage: SQLite-backed localStorage (recommended by Expo for Supabase).
import 'expo-sqlite/localStorage/install';

export const authStorage = {
  getItem: (key: string) => globalThis.localStorage.getItem(key),
  setItem: (key: string, value: string) => globalThis.localStorage.setItem(key, value),
  removeItem: (key: string) => globalThis.localStorage.removeItem(key),
};
