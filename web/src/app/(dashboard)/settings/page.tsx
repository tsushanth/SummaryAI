'use client';

import { useState } from 'react';
import { User, LogOut, Loader2, Sparkles, CreditCard, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';
import { useSubscription, useCustomerPortal } from '@/hooks/useSubscription';
import Link from 'next/link';

export default function SettingsPage() {
  const { user, signOut, loading } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { isPremium, status, plan, expiresAt, isLoading: subscriptionLoading } = useSubscription();
  const { openPortal, isLoading: portalLoading } = useCustomerPortal();

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOut();
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Manage your account settings</p>
      </div>

      <div className="space-y-6">
        {/* Subscription Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Subscription
            </CardTitle>
            <CardDescription>
              {isPremium ? 'Manage your Pro subscription' : 'Upgrade to unlock all features'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {subscriptionLoading ? (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : isPremium ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      Meeting Mind Pro
                      {plan && (
                        <span className="text-gray-500 font-normal ml-1">
                          ({plan.charAt(0).toUpperCase() + plan.slice(1)})
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-gray-500 flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {status === 'trialing' ? 'Trial ends' : 'Renews'}{' '}
                      {expiresAt ? new Date(expiresAt).toLocaleDateString() : 'N/A'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={openPortal}
                  disabled={portalLoading}
                >
                  {portalLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4 mr-2" />
                  )}
                  Manage Subscription
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  You&apos;re on the free plan. Upgrade to Pro for unlimited recordings,
                  AI summaries, meeting bot, and more.
                </p>
                <div className="flex gap-3">
                  <Link href="/subscription">
                    <Button>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Upgrade to Pro
                    </Button>
                  </Link>
                </div>
                <p className="text-xs text-gray-500">
                  7-day free trial with yearly plan
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profile Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Profile
            </CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              {user?.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Profile"
                  className="w-16 h-16 rounded-full"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
                  <span className="text-xl font-semibold text-blue-600">
                    {user?.user_metadata?.full_name?.[0] || user?.email?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
              )}
              <div>
                <p className="font-medium text-gray-900">
                  {user?.user_metadata?.full_name || 'User'}
                </p>
                <p className="text-sm text-gray-500">{user?.email}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Card */}
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Sign out of your account</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={handleSignOut}
              disabled={isSigningOut}
            >
              {isSigningOut ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Signing out...
                </>
              ) : (
                <>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* About Card */}
        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
            <CardDescription>Meeting Mind Web App</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-gray-600 space-y-2">
            <p>
              Meeting Mind helps you capture, transcribe, and summarize your meetings
              and conversations with AI-powered insights.
            </p>
            <p className="text-gray-400">Version 1.0.0</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
