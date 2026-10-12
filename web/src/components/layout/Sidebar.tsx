'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { Mic, ListTodo, Settings, LogOut, Calendar, Sparkles } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useSubscription } from '@/hooks/useSubscription';

const navigation = [
  { name: 'Recordings', href: '/recordings', icon: Mic },
  { name: 'Meetings', href: '/meetings', icon: Calendar },
  { name: 'Todos', href: '/todos', icon: ListTodo },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { isSubscribed, isLoading: subscriptionLoading } = useSubscription();

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth');
  };

  return (
    <div className="flex flex-col h-full bg-card border-r border-border w-64">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-4 border-b border-border">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
          <Mic className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
        </div>
        <span className="font-semibold text-lg">Meeting Mind</span>
      </div>

      {/* Navigation */}
      <nav aria-label="Main" className="flex-1 px-4 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex min-h-[44px] items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="w-5 h-5" aria-hidden="true" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Upgrade CTA for free users */}
      {!subscriptionLoading && !isSubscribed && (
        <div className="px-4 pb-4">
          <Link
            href="/subscription"
            className="flex items-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            <Sparkles className="w-5 h-5" aria-hidden="true" />
            <div className="flex-1">
              <p className="font-medium text-sm">Upgrade to Pro</p>
              <p className="text-xs text-primary-foreground/90">Save 30% on web</p>
            </div>
          </Link>
        </div>
      )}

      {/* User section */}
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-secondary-foreground font-medium">
            {user?.email?.[0].toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {user?.user_metadata?.full_name || 'User'}
            </p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex min-h-[44px] items-center gap-2 w-full px-3 py-2 text-sm text-foreground/80 hover:bg-accent hover:text-accent-foreground rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  );
}
