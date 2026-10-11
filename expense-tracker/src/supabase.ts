import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// Set in .env (see .env.example). The anon key is meant to be public; access is enforced by
// row-level security in supabase/schema.sql.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || 'http://localhost', anonKey || 'not-configured', {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // On web, the links in confirmation / password-reset emails land back on the app with the
    // session in the URL.
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// Where the links in auth emails should send the user back to.
export const authRedirectUrl = () =>
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin + window.location.pathname
    : undefined;
