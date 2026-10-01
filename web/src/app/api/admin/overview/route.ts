// GET /api/admin/overview: authenticates the signed-in user, then proxies the reporter Worker.
// Requires env: ADMIN_DASH_SECRET (same value as the Worker's DASH_SECRET). Optional: ADMIN_EMAILS.
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin/isAdmin';

const APP = 'meetingmind';
const WORKER = 'https://app-failure-reporter.t-sushanth.workers.dev';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!(await isAdmin())) return new NextResponse('Not found', { status: 404 });

  const secret = process.env.ADMIN_DASH_SECRET;
  if (!secret) return NextResponse.json({ error: 'ADMIN_DASH_SECRET not configured' }, { status: 500 });

  const hours = Math.min(Math.max(Number(new URL(request.url).searchParams.get('hours')) || 24, 1), 720);
  const res = await fetch(`${WORKER}/admin/api/overview?app=${APP}&hours=${hours}`, {
    headers: { 'X-Dash-Secret': secret },
    cache: 'no-store',
  });
  if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
  return NextResponse.json(await res.json(), { headers: { 'Cache-Control': 'no-store' } });
}
