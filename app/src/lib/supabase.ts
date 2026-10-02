import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import type { Database } from './database.types';
import { authStorage } from './storage';

function resolveUrl(raw: string | undefined): string {
  const url = raw ?? 'http://127.0.0.1:54321';
  // The Android emulator reaches the host machine through 10.0.2.2.
  if (Platform.OS === 'android') return url.replace(/\/\/(127\.0\.0\.1|localhost)(?=[:/]|$)/, '//10.0.2.2');
  return url;
}

export const SUPABASE_URL = resolveUrl(process.env.EXPO_PUBLIC_SUPABASE_URL);
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
