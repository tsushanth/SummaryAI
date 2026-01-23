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

// ============================================================================
// Admin endpoints for payment management (requires INTERNAL_SECRET)
// ============================================================================

/**
 * Verify internal admin request
 */
function verifyInternalRequest(req: Request): boolean {
  const internalSecret = config.INTERNAL_SECRET;
  if (!internalSecret) return false;

  const authHeader = req.headers['x-internal-secret'] as string;
  return authHeader === internalSecret;
}

/**
 * GET /api/subscriptions/admin/failed-payments
 * List all customers with failed/past_due payments
 * Requires INTERNAL_SECRET header
 */
router.get('/admin/failed-payments', async (req: Request, res: Response) => {
  if (!verifyInternalRequest(req)) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid internal secret' } });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({ error: { code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe not configured' } });
    return;
  }

  try {
    // Get users with past_due status from our database
    const { data: pastDueUsers, error: dbError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_plan')
      .eq('subscription_status', 'past_due');

    if (dbError) {
      throw dbError;
    }

    // Also fetch recent failed invoices from Stripe
    const failedInvoices = await stripe.invoices.list({
      status: 'open',
      limit: 100,
    });

    const failedPayments = failedInvoices.data
      .filter(inv => inv.attempted && !inv.paid)
      .map(inv => ({
        invoiceId: inv.id,
        customerId: inv.customer,
        customerEmail: inv.customer_email,
        amount: inv.amount_due,
        amountFormatted: `$${(inv.amount_due / 100).toFixed(2)}`,
        created: new Date(inv.created * 1000).toISOString(),
        attemptCount: inv.attempt_count,
        nextAttempt: inv.next_payment_attempt
          ? new Date(inv.next_payment_attempt * 1000).toISOString()
          : null,
        hostedInvoiceUrl: inv.hosted_invoice_url,
        subscriptionId: inv.subscription,
      }));

    res.json({
      pastDueUsers: pastDueUsers || [],
      failedInvoices: failedPayments,
      summary: {
        totalPastDueUsers: pastDueUsers?.length || 0,
        totalFailedInvoices: failedPayments.length,
        totalAmountDue: failedPayments.reduce((sum, inv) => sum + inv.amount, 0),
      },
    });
  } catch (err) {
    console.error('[Subscriptions] Admin failed-payments error:', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch failed payments' } });
  }
});

/**
 * POST /api/subscriptions/admin/send-payment-link
 * Send a payment update link to a customer
 * Requires INTERNAL_SECRET header
 */
router.post('/admin/send-payment-link', async (req: Request, res: Response) => {
  if (!verifyInternalRequest(req)) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid internal secret' } });
    return;
  }

  const { customerId, userId } = req.body as { customerId?: string; userId?: string };

  if (!customerId && !userId) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'customerId or userId required' } });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({ error: { code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe not configured' } });
    return;
  }

  try {
    let stripeCustomerId = customerId;
    let userEmail: string | null = null;

    // If userId provided, look up the customer ID
    if (userId && !stripeCustomerId) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id, email')
        .eq('id', userId)
        .single();

      stripeCustomerId = profile?.stripe_customer_id;
      userEmail = profile?.email;
    }

    if (!stripeCustomerId) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No Stripe customer found' } });
      return;
    }

    // Create a portal session for the customer to update payment method
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${config.WEB_APP_URL}/settings`,
    });

    console.log(`[Subscriptions] Created payment update portal for customer ${stripeCustomerId}`);

    res.json({
      success: true,
      portalUrl: portalSession.url,
      customerId: stripeCustomerId,
      userEmail,
      message: 'Portal URL generated. Send this to the customer to update their payment method.',
    });
  } catch (err) {
    console.error('[Subscriptions] Admin send-payment-link error:', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to create payment link' } });
  }
});

/**
 * POST /api/subscriptions/admin/retry-invoice
 * Retry a failed invoice payment
 * Requires INTERNAL_SECRET header
 */
router.post('/admin/retry-invoice', async (req: Request, res: Response) => {
  if (!verifyInternalRequest(req)) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid internal secret' } });
    return;
  }

  const { invoiceId } = req.body as { invoiceId?: string };

  if (!invoiceId) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'invoiceId required' } });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({ error: { code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe not configured' } });
    return;
  }

  try {
    // Attempt to pay the invoice again
    const invoice = await stripe.invoices.pay(invoiceId);

    console.log(`[Subscriptions] Retried invoice ${invoiceId}, status: ${invoice.status}`);

    res.json({
      success: invoice.paid,
      invoiceId: invoice.id,
      status: invoice.status,
      paid: invoice.paid,
      amountPaid: invoice.amount_paid,
    });
  } catch (err) {
    const stripeError = err as Stripe.errors.StripeError;
    console.error('[Subscriptions] Admin retry-invoice error:', err);
    res.status(400).json({
      error: {
        code: 'RETRY_FAILED',
        message: stripeError.message || 'Failed to retry invoice',
        declineCode: stripeError.decline_code,
      },
    });
  }
});

export default router;
