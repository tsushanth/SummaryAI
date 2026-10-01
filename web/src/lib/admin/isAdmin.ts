import { createClient } from '@/lib/supabase/server';

/**
 * True only for an allowlisted email that signed in with Google and has a confirmed
 * address. Supabase can also create email/password users, so matching the email alone
 * is not enough: someone could register the admin address without owning it.
 */
export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !user.email_confirmed_at) return false;
  const viaGoogle = user.identities?.some((i) => i.provider === 'google') ?? false;
  if (!viaGoogle) return false;
  const allowed = (process.env.ADMIN_EMAILS || 't.sushanth@gmail.com').split(',').map((e) => e.trim().toLowerCase());
  return allowed.includes(user.email.toLowerCase());
}
