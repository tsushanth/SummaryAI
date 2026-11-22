import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/admin/isAdmin';
import { validateGaugemintEmbedUrl } from '@/lib/gaugemintEmbed';
import AdminDashboard from '@/components/AdminDashboard';
import AdminGaugemintEmbed from '@/components/AdminGaugemintEmbed';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin', robots: { index: false, follow: false } };

export default async function AdminPage() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) redirect('/auth');
  if (!(await isAdmin())) notFound();
  // Server-only capability URL (never NEXT_PUBLIC_): read after the admin check, validated, rendered into admin HTML only.
  // Unset or invalid renders nothing.
  const embedSrc = validateGaugemintEmbedUrl(process.env.GAUGEMINT_EMBED_URL, process.env.GAUGEMINT_URL);
  return (
    <>
      <AdminDashboard />
      {embedSrc && <AdminGaugemintEmbed src={embedSrc} />}
    </>
  );
}
