/**
 * Subscription Routes
 * Handles Stripe subscriptions for Meeting Mind Pro
 */

import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import type { ErrorResponse } from '../types/api.js';

const router = Router();

// Initialize Stripe client
function getStripeClient(): Stripe | null {
  if (!config.STRIPE_SECRET_KEY) {
    return null;
  }
  return new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
  });
}

// Stripe price IDs mapped to plan types
const PRICE_IDS: Record<string, string | undefined> = {
  weekly: config.STRIPE_PRICE_WEEKLY,
  monthly: config.STRIPE_PRICE_MONTHLY,
  yearly: config.STRIPE_PRICE_YEARLY,
};

// Plan prices in cents (for display)
const PLAN_PRICES = {
  weekly: 489, // $4.89
  monthly: 1049, // $10.49
  yearly: 4899, // $48.99
};

// Apply authentication to all routes
router.use(authenticate);

/**
 * GET /api/subscriptions/status
 * Get current subscription status for authenticated user
 */
router.get('/status', async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'User not authenticated',
      },
    });
    return;
  }

  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select(
        'subscription_status, subscription_provider, subscription_plan, subscription_expires_at, subscribed_at'
      )
      .eq('id', userId)
      .single();

    if (error) {
      console.error(`[Subscriptions] Error fetching profile: ${error.message}`);
      res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to fetch subscription status',
        },
      });
      return;
    }

    const isSubscribed =
      profile?.subscription_status === 'active' ||
      profile?.subscription_status === 'trialing';

    // Check if subscription has expired
    let effectiveStatus = profile?.subscription_status || 'free';
    if (
      profile?.subscription_expires_at &&
      new Date(profile.subscription_expires_at) < new Date()
    ) {
      effectiveStatus = 'expired';
    }

    res.json({
      isSubscribed,
      status: effectiveStatus,
      plan: profile?.subscription_plan || null,
      provider: profile?.subscription_provider || null,
      expiresAt: profile?.subscription_expires_at || null,
      subscribedAt: profile?.subscribed_at || null,
      features: {
        unlimitedRecordings: isSubscribed,
        aiSummaries: isSubscribed,
        qaChat: isSubscribed,
        meetingBot: isSubscribed,
        phoneRecording: isSubscribed,
        calendarSync: isSubscribed,
        exportPdf: isSubscribed,
      },
    });
  } catch (err) {
    console.error('[Subscriptions] Get status error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'An error occurred while fetching subscription status',
      },
    });
  }
});

/**
 * POST /api/subscriptions/checkout
 * Create a Stripe Checkout session
 */
router.post(
  '/checkout',
  async (
    req: Request,
    res: Response<{ checkoutUrl: string; sessionId: string } | ErrorResponse>
  ) => {
    const userId = req.user?.id;
    const { planType } = req.body as { planType?: string };

    if (!userId) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
        },
      });
      return;
    }

    if (!planType || !['weekly', 'monthly', 'yearly'].includes(planType)) {
      res.status(400).json({
        error: {
          code: 'INVALID_PLAN',
          message: 'Invalid plan type. Must be weekly, monthly, or yearly.',
        },
      });
      return;
    }

    const stripe = getStripeClient();
    if (!stripe) {
      res.status(503).json({
        error: {
          code: 'STRIPE_NOT_CONFIGURED',
          message: 'Stripe is not configured',
        },
      });
      return;
    }

    const priceId = PRICE_IDS[planType];
    if (!priceId) {
      res.status(503).json({
        error: {
          code: 'PRICE_NOT_CONFIGURED',
          message: `Stripe price for ${planType} plan is not configured`,
        },
      });
      return;
    }

    try {
      // Get user profile
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, stripe_customer_id, subscription_status')
        .eq('id', userId)
        .single();

      // Check if already subscribed
      if (
        profile?.subscription_status === 'active' ||
        profile?.subscription_status === 'trialing'
      ) {
        res.status(400).json({
          error: {
            code: 'ALREADY_SUBSCRIBED',
            message: 'You already have an active subscription',
          },
        });
        return;
      }

      // Create or reuse Stripe customer
      let customerId = profile?.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: profile?.email || req.user?.email,
          metadata: {
            user_id: userId,
          },
        });
        customerId = customer.id;

        // Save Stripe customer ID
        await supabaseAdmin
          .from('profiles')
          .update({ stripe_customer_id: customerId })
          .eq('id', userId);
      }

      // Create checkout session
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer: customerId,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${config.WEB_APP_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.WEB_APP_URL}/subscription?canceled=true`,
        metadata: {
          user_id: userId,
          plan_type: planType,
        },
        subscription_data: {
          metadata: {
            user_id: userId,
            plan_type: planType,
          },
          // Add 7-day trial for yearly plans
          ...(planType === 'yearly' && {
            trial_period_days: 7,
          }),
        },
        allow_promotion_codes: true,
      });

      console.log(
        `[Subscriptions] Created checkout session ${session.id} for user ${userId}, plan: ${planType}`
      );

      res.json({
        checkoutUrl: session.url!,
        sessionId: session.id,
      });
    } catch (err) {
      console.error('[Subscriptions] Create checkout error:', err);
      res.status(500).json({
        error: {
          code: 'CHECKOUT_FAILED',
          message: 'Failed to create checkout session',
        },
      });
    }
  }
);

/**
 * POST /api/subscriptions/portal
 * Create a Stripe Customer Portal session for subscription management
 */
router.post(
  '/portal',
  async (req: Request, res: Response<{ portalUrl: string } | ErrorResponse>) => {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
        },
      });
      return;
    }

    const stripe = getStripeClient();
    if (!stripe) {
      res.status(503).json({
        error: {
          code: 'STRIPE_NOT_CONFIGURED',
          message: 'Stripe is not configured',
        },
      });
      return;
    }

    try {
      // Get user's Stripe customer ID
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', userId)
        .single();

      if (!profile?.stripe_customer_id) {
        res.status(400).json({
          error: {
            code: 'NO_SUBSCRIPTION',
            message: 'No subscription found',
          },
        });
        return;
      }

      // Create portal session
      const session = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${config.WEB_APP_URL}/settings`,
      });

      console.log(
        `[Subscriptions] Created portal session for user ${userId}`
      );

      res.json({
        portalUrl: session.url,
      });
    } catch (err) {
      console.error('[Subscriptions] Create portal error:', err);
      res.status(500).json({
        error: {
          code: 'PORTAL_FAILED',
          message: 'Failed to create portal session',
        },
      });
    }
  }
);

/**
 * GET /api/subscriptions/prices
 * Get available subscription prices (public info)
 */
router.get('/prices', async (_req: Request, res: Response) => {
  res.json({
    prices: [
      {
        planType: 'weekly',
        price: PLAN_PRICES.weekly,
        currency: 'usd',
        interval: 'week',
        displayPrice: '$4.89/week',
        savingsVsAppStore: '30%',
        appStorePrice: '$6.99/week',
      },
      {
        planType: 'monthly',
        price: PLAN_PRICES.monthly,
        currency: 'usd',
        interval: 'month',
        displayPrice: '$10.49/month',
        savingsVsAppStore: '30%',
        appStorePrice: '$14.99/month',
      },
      {
        planType: 'yearly',
        price: PLAN_PRICES.yearly,
        currency: 'usd',
        interval: 'year',
        displayPrice: '$48.99/year',
        savingsVsAppStore: '30%',
        appStorePrice: '$69.99/year',
        trialDays: 7,
        highlighted: true,
        monthlyEquivalent: '$4.08/month',
      },
    ],
  });
});

export default router;
