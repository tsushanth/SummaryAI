'use client';

import { useState } from 'react';
import { User, LogOut, Loader2, Sparkles, CreditCard, Calendar, Plug } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';
import { useSubscription, useCustomerPortal } from '@/hooks/useSubscription';
import Link from 'next/link';
import { DefaultTemplateCard } from '@/components/settings/DefaultTemplateCard';

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
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground">Manage your account settings</p>
      </div>

      <div className="space-y-6">
        <DefaultTemplateCard />

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
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : isPremium ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      Meeting Mind Pro
                      {plan && (
                        <span className="text-muted-foreground font-normal ml-1">
                          ({plan.charAt(0).toUpperCase() + plan.slice(1)})
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
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
                <p className="text-sm text-muted-foreground">
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
                <p className="text-xs text-muted-foreground">
                  7-day free trial with yearly plan
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              Integrations
            </CardTitle>
            <CardDescription>Send summaries to a webhook, Slack or Notion</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/settings/integrations">
              <Button variant="outline">Manage integrations</Button>
            </Link>
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
                <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center">
                  <span className="text-xl font-semibold text-primary">
                    {user?.user_metadata?.full_name?.[0] || user?.email?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
              )}
              <div>
                <p className="font-medium text-foreground">
                  {user?.user_metadata?.full_name || 'User'}
                </p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
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
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Meeting Mind helps you capture, transcribe, and summarize your meetings
              and conversations with AI-powered insights.
            </p>
            <p className="text-muted-foreground">Version 1.0.0</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
