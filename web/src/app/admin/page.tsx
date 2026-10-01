import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin/isAdmin';
import AdminDashboard from '@/components/AdminDashboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin', robots: { index: false, follow: false } };

export default async function AdminPage() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) redirect('/auth');
  if (!(await isAdmin())) notFound();
  return <AdminDashboard />;
}
