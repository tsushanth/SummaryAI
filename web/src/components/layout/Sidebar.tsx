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
    <div className="flex flex-col h-full bg-white border-r w-64">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-4 border-b">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
          <Mic className="w-5 h-5 text-white" />
        </div>
        <span className="font-semibold text-lg">Meeting Mind</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              )}
            >
              <item.icon className="w-5 h-5" />
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
            className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-primary to-purple-600 text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            <Sparkles className="w-5 h-5" />
            <div className="flex-1">
              <p className="font-medium text-sm">Upgrade to Pro</p>
              <p className="text-xs text-white/80">Save 30% vs App Store</p>
            </div>
          </Link>
        </div>
      )}

      {/* User section */}
      <div className="border-t p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-medium">
            {user?.email?.[0].toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {user?.user_metadata?.full_name || 'User'}
            </p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}
