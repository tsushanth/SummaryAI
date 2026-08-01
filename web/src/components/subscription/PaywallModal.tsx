'use client';

import { X, Sparkles, Mic, FileText, MessageSquare, Zap } from 'lucide-react';
import { useCheckout } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';

interface PaywallModalProps {
  onClose?: () => void;
  reason?: 'recording_limit' | 'feature';
}

export function PaywallModal({ onClose, reason = 'recording_limit' }: PaywallModalProps) {
  const { startCheckout, isLoading } = useCheckout();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header gradient */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-600 px-6 pt-8 pb-10 text-white">
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mb-4">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Upgrade to Pro</h2>
          <p className="text-blue-100">
            {reason === 'recording_limit'
              ? "You've used all 3 free recordings. Upgrade to keep going."
              : 'This feature requires a Pro subscription.'}
          </p>
        </div>

        {/* Features list */}
        <div className="-mt-4 bg-white rounded-t-2xl px-6 pt-6 pb-2">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
            Everything in Pro
          </p>
          <ul className="space-y-3 mb-6">
            {[
              { icon: Mic, text: 'Unlimited recordings' },
              { icon: FileText, text: 'AI summaries for every meeting' },
              { icon: MessageSquare, text: 'Ask questions about your recordings' },
              { icon: Zap, text: 'Calendar sync & meeting bot' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-gray-700">
                <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-sm font-medium">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Pricing options */}
        <div className="px-6 pb-6 space-y-3">
          <Button
            className="w-full bg-blue-600 hover:bg-blue-700 text-white h-12 text-base font-semibold"
            onClick={() => startCheckout('yearly')}
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : 'Start 7-day free trial — $48.99/yr'}
          </Button>
          <Button
            variant="outline"
            className="w-full h-10 text-sm text-gray-600"
            onClick={() => startCheckout('monthly')}
            disabled={isLoading}
          >
            Monthly — $10.49/month
          </Button>
          <p className="text-center text-xs text-gray-400">
            30% cheaper than the App Store. Cancel anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
