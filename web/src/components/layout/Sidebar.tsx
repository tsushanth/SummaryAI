'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { Mic, ListTodo, Settings, LogOut, Calendar, Sparkles, Search, MessageSquare, Menu, X } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useSubscription } from '@/hooks/useSubscription';
import { RibbonMark } from '@/components/ui/ribbon-mark';

const navigation = [
  { name: 'Recordings', href: '/recordings', icon: Mic },
  { name: 'Search', href: '/search', icon: Search },
  { name: 'Ask AI', href: '/chat', icon: MessageSquare },
  { name: 'Meetings', href: '/meetings', icon: Calendar },
  { name: 'Todos', href: '/todos', icon: ListTodo },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { isSubscribed, isLoading: subscriptionLoading } = useSubscription();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer on navigation and on Escape
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth');
  };

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-border bg-card px-3 md:hidden">
        <Link href="/recordings" className="flex items-center gap-2 rounded-md px-1 font-semibold tracking-tight">
          <RibbonMark />
          MeetingMind
        </Link>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="app-sidebar"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent"
        >
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-foreground/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="app-sidebar"
        className={cn(
          'z-40 flex w-64 flex-col border-r border-border bg-card',
          'fixed inset-y-0 left-0 transition-transform md:static md:h-full md:w-60 md:translate-x-0 md:flex-shrink-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5">
          <RibbonMark className="h-7 w-7" />
          <span className="text-lg font-semibold tracking-tight">MeetingMind</span>
        </div>

        {/* Navigation */}
        <nav aria-label="Main" className="flex-1 space-y-0.5 px-3 py-2">
          {navigation.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent font-semibold text-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary'
                    : 'font-medium text-foreground/80 hover:bg-muted hover:text-foreground'
                )}
              >
                <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Upgrade note for free users: a marked-up line, not a banner */}
        {!subscriptionLoading && !isSubscribed && (
          <div className="px-3 pb-3">
            <Link
              href="/subscription"
              className="flex items-center gap-2.5 rounded-md bg-mark px-3 py-2.5 text-mark-foreground transition-opacity hover:opacity-90"
            >
              <Sparkles className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <p className="text-sm font-semibold">Upgrade to Pro</p>
                <p className="text-xs">Q&amp;A, meeting bot, phone calls</p>
              </div>
            </Link>
          </div>
        )}

        {/* User section */}
        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center gap-3 px-2">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
              {user?.email?.[0].toUpperCase() || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {user?.user_metadata?.full_name || 'User'}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
