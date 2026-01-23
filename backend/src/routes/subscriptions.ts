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

    console.log(`[Subscriptions] Checkout request - userId: ${userId}, planType: ${planType}, body:`, req.body);

    if (!userId) {
      console.log('[Subscriptions] Checkout failed: User not authenticated');
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
        },
      });
      return;
    }

    if (!planType || !['weekly', 'monthly', 'yearly'].includes(planType)) {
      console.log(`[Subscriptions] Checkout failed: Invalid plan type "${planType}"`);
      res.status(400).json({
        error: {
          code: 'INVALID_PLAN',
          message: `Invalid plan type. Must be weekly, monthly, or yearly. Received: ${planType}`,
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
        console.log(`[Subscriptions] Checkout failed: User ${userId} already subscribed (status: ${profile.subscription_status})`);
        res.status(400).json({
          error: {
            code: 'ALREADY_SUBSCRIBED',
            message: `You already have an active subscription (status: ${profile.subscription_status})`,
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

/**
 * GET /api/subscriptions/admin/sync-check
 * Find Stripe subscriptions that aren't properly synced to the database
 * (customers who paid but webhook failed)
 * Requires INTERNAL_SECRET header
 */
router.get('/admin/sync-check', async (req: Request, res: Response) => {
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
    // Get all active/trialing subscriptions from Stripe
    const stripeSubscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
      expand: ['data.customer'],
    });

    const trialingSubscriptions = await stripe.subscriptions.list({
      status: 'trialing',
      limit: 100,
      expand: ['data.customer'],
    });

    const allStripeSubscriptions = [
      ...stripeSubscriptions.data,
      ...trialingSubscriptions.data,
    ];

    // Get all users with active subscriptions from our database
    const { data: activeDbUsers } = await supabaseAdmin
      .from('profiles')
      .select('id, email, stripe_customer_id, stripe_subscription_id, subscription_status')
      .in('subscription_status', ['active', 'trialing']);

    const dbSubscriptionIds = new Set(
      (activeDbUsers || []).map(u => u.stripe_subscription_id).filter(Boolean)
    );

    // Find Stripe subscriptions not in our database
    const missingInDb = allStripeSubscriptions
      .filter(sub => !dbSubscriptionIds.has(sub.id))
      .map(sub => {
        const customer = sub.customer as Stripe.Customer;
        const price = sub.items.data[0]?.price;
        let planType = sub.metadata?.plan_type || null;

        // Infer plan type from price interval if not in metadata
        if (!planType && price?.recurring) {
          if (price.recurring.interval === 'week') planType = 'weekly';
          else if (price.recurring.interval === 'month') planType = 'monthly';
          else if (price.recurring.interval === 'year') planType = 'yearly';
        }

        return {
          subscriptionId: sub.id,
          customerId: customer.id,
          customerEmail: customer.email,
          status: sub.status,
          planType,
          userId: sub.metadata?.user_id || null,
          currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
          created: new Date(sub.created * 1000).toISOString(),
        };
      });

    res.json({
      missingInDatabase: missingInDb,
      summary: {
        totalStripeActive: allStripeSubscriptions.length,
        totalDbActive: activeDbUsers?.length || 0,
        missingCount: missingInDb.length,
      },
      message: missingInDb.length > 0
        ? 'Found subscriptions in Stripe that are not synced to database. Use POST /admin/sync-subscription to fix.'
        : 'All Stripe subscriptions are synced to database.',
    });
  } catch (err) {
    console.error('[Subscriptions] Admin sync-check error:', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to check sync status' } });
  }
});

/**
 * POST /api/subscriptions/admin/sync-subscription
 * Manually sync a Stripe subscription to the database
 * Requires INTERNAL_SECRET header
 */
router.post('/admin/sync-subscription', async (req: Request, res: Response) => {
  if (!verifyInternalRequest(req)) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid internal secret' } });
    return;
  }

  const { subscriptionId, userId } = req.body as { subscriptionId?: string; userId?: string };

  if (!subscriptionId) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'subscriptionId required' } });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({ error: { code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe not configured' } });
    return;
  }

  try {
    // Fetch the subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['customer'],
    });

    const customer = subscription.customer as Stripe.Customer;

    // Determine user ID: from request, from metadata, or find by email/customer_id
    let targetUserId = userId || subscription.metadata?.user_id;

    if (!targetUserId) {
      // Try to find user by stripe_customer_id
      const { data: profileByCustomer } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customer.id)
        .single();

      if (profileByCustomer) {
        targetUserId = profileByCustomer.id;
      } else if (customer.email) {
        // Try to find user by email
        const { data: profileByEmail } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('email', customer.email)
          .single();

        if (profileByEmail) {
          targetUserId = profileByEmail.id;
        }
      }
    }

    if (!targetUserId) {
      res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Could not find user for this subscription. Provide userId parameter or ensure user exists with matching email.',
        },
        customerEmail: customer.email,
        customerId: customer.id,
      });
      return;
    }

    // Determine plan type
    const price = subscription.items.data[0]?.price;
    let planType = subscription.metadata?.plan_type || null;
    if (!planType && price?.recurring) {
      if (price.recurring.interval === 'week') planType = 'weekly';
      else if (price.recurring.interval === 'month') planType = 'monthly';
      else if (price.recurring.interval === 'year') planType = 'yearly';
    }

    // Update the user's subscription in database
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        subscription_status: subscription.status === 'trialing' ? 'trialing' : 'active',
        subscription_provider: 'stripe',
        subscription_plan: planType,
        subscription_expires_at: new Date(subscription.current_period_end * 1000).toISOString(),
        stripe_customer_id: customer.id,
        stripe_subscription_id: subscription.id,
        subscribed_at: new Date(subscription.created * 1000).toISOString(),
      })
      .eq('id', targetUserId);

    if (updateError) {
      throw updateError;
    }

    console.log(`[Subscriptions] Synced subscription ${subscriptionId} to user ${targetUserId}`);

    res.json({
      success: true,
      message: 'Subscription synced successfully',
      userId: targetUserId,
      subscriptionId: subscription.id,
      status: subscription.status,
      planType,
      customerEmail: customer.email,
      expiresAt: new Date(subscription.current_period_end * 1000).toISOString(),
    });
  } catch (err) {
    console.error('[Subscriptions] Admin sync-subscription error:', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to sync subscription' } });
  }
});

/**
 * POST /api/subscriptions/admin/sync-all
 * Sync all missing Stripe subscriptions to the database
 * Requires INTERNAL_SECRET header
 */
router.post('/admin/sync-all', async (req: Request, res: Response) => {
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
    // Get all active/trialing subscriptions from Stripe
    const stripeSubscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
      expand: ['data.customer'],
    });

    const trialingSubscriptions = await stripe.subscriptions.list({
      status: 'trialing',
      limit: 100,
      expand: ['data.customer'],
    });

    const allStripeSubscriptions = [
      ...stripeSubscriptions.data,
      ...trialingSubscriptions.data,
    ];

    const results: Array<{ subscriptionId: string; customerEmail: string | null; status: string; error?: string }> = [];

    for (const subscription of allStripeSubscriptions) {
      const customer = subscription.customer as Stripe.Customer;

      // Check if already synced
      const { data: existing } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('stripe_subscription_id', subscription.id)
        .single();

      if (existing) {
        results.push({
          subscriptionId: subscription.id,
          customerEmail: customer.email,
          status: 'already_synced',
        });
        continue;
      }

      // Try to find user
      let targetUserId = subscription.metadata?.user_id;

      if (!targetUserId) {
        const { data: profileByCustomer } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customer.id)
          .single();

        if (profileByCustomer) {
          targetUserId = profileByCustomer.id;
        } else if (customer.email) {
          const { data: profileByEmail } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('email', customer.email)
            .single();

          if (profileByEmail) {
            targetUserId = profileByEmail.id;
          }
        }
      }

      if (!targetUserId) {
        results.push({
          subscriptionId: subscription.id,
          customerEmail: customer.email,
          status: 'user_not_found',
          error: 'No matching user in database',
        });
        continue;
      }

      // Sync the subscription
      const price = subscription.items.data[0]?.price;
      let planType = subscription.metadata?.plan_type || null;
      if (!planType && price?.recurring) {
        if (price.recurring.interval === 'week') planType = 'weekly';
        else if (price.recurring.interval === 'month') planType = 'monthly';
        else if (price.recurring.interval === 'year') planType = 'yearly';
      }

      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          subscription_status: subscription.status === 'trialing' ? 'trialing' : 'active',
          subscription_provider: 'stripe',
          subscription_plan: planType,
          subscription_expires_at: new Date(subscription.current_period_end * 1000).toISOString(),
          stripe_customer_id: customer.id,
          stripe_subscription_id: subscription.id,
          subscribed_at: new Date(subscription.created * 1000).toISOString(),
        })
        .eq('id', targetUserId);

      if (updateError) {
        results.push({
          subscriptionId: subscription.id,
          customerEmail: customer.email,
          status: 'error',
          error: updateError.message,
        });
      } else {
        results.push({
          subscriptionId: subscription.id,
          customerEmail: customer.email,
          status: 'synced',
        });
      }
    }

    const synced = results.filter(r => r.status === 'synced').length;
    const alreadySynced = results.filter(r => r.status === 'already_synced').length;
    const notFound = results.filter(r => r.status === 'user_not_found').length;
    const errors = results.filter(r => r.status === 'error').length;

    res.json({
      results,
      summary: {
        total: results.length,
        synced,
        alreadySynced,
        userNotFound: notFound,
        errors,
      },
    });
  } catch (err) {
    console.error('[Subscriptions] Admin sync-all error:', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to sync subscriptions' } });
  }
});

export default router;
