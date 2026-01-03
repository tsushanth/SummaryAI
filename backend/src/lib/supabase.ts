/**
 * Supabase client configuration
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

/**
 * Supabase client with service role key for admin operations
 * Use this for server-side operations that bypass RLS
 */
export const supabaseAdmin: SupabaseClient = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Create a Supabase client with a user's access token
 * This client respects RLS policies
 */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(
    config.SUPABASE_URL,
    config.SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/**
 * Test Supabase connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    // Just test that we can make a request to Supabase
    // Don't fail if tables don't exist yet (schema cache errors are OK)
    const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
    if (error) {
      // Allow schema cache errors (table doesn't exist) - DB can still be used
      if (error.message.includes('schema cache') || error.message.includes('not found') || error.code === 'PGRST204') {
        console.warn('Supabase tables may not exist yet:', error.message);
        console.log('✅ Supabase connection successful (tables may need to be created)');
        return true;
      }
      console.error('Supabase connection test failed:', error.message);
      return false;
    }
    console.log('✅ Supabase connection successful');
    return true;
  } catch (err) {
    console.error('Supabase connection error:', err);
    return false;
  }
}
