import { apiClient } from './client';

/**
 * Permanently delete the signed-in user's account (DELETE /api/users/account). The backend removes the user's
 * rows and then the Supabase auth user; see the route in backend/src/routes/users.ts for exactly what is covered.
 */
export async function deleteAccount(): Promise<void> {
  await apiClient('/api/users/account', { method: 'DELETE' });
}
