/**
 * Alerting Service
 * Sends notifications for critical events like webhook failures and payment issues
 */

interface AlertPayload {
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  context?: Record<string, unknown>;
}

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * Send alert to Slack
 */
async function sendSlackAlert(payload: AlertPayload): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    console.warn('[Alerting] SLACK_WEBHOOK_URL not configured, logging alert only');
    return;
  }

  const color = {
    info: '#36a64f',
    warning: '#ffcc00',
    error: '#ff6600',
    critical: '#ff0000',
  }[payload.severity];

  const emoji = {
    info: ':information_source:',
    warning: ':warning:',
    error: ':x:',
    critical: ':rotating_light:',
  }[payload.severity];

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [
          {
            color,
            blocks: [
              {
                type: 'header',
                text: {
                  type: 'plain_text',
                  text: `${emoji} ${payload.title}`,
                  emoji: true,
                },
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: payload.message,
                },
              },
              ...(payload.context
                ? [
                    {
                      type: 'section',
                      text: {
                        type: 'mrkdwn',
                        text: `\`\`\`${JSON.stringify(payload.context, null, 2)}\`\`\``,
                      },
                    },
                  ]
                : []),
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: `*Environment:* ${process.env.NODE_ENV || 'development'} | *Time:* ${new Date().toISOString()}`,
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('[Alerting] Failed to send Slack alert:', response.status);
    }
  } catch (error) {
    console.error('[Alerting] Error sending Slack alert:', error);
  }
}

/**
 * Alert for Stripe webhook failures
 */
export async function alertWebhookFailure(
  eventType: string,
  error: Error | unknown,
  eventData?: Record<string, unknown>
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  console.error(`[ALERT] Stripe webhook failure - ${eventType}:`, errorMessage);

  await sendSlackAlert({
    title: 'Stripe Webhook Failure',
    message: `*Event:* ${eventType}\n*Error:* ${errorMessage}`,
    severity: 'critical',
    context: eventData,
  });
}

/**
 * Alert for payment failures
 */
export async function alertPaymentFailure(
  userId: string,
  customerEmail: string | null,
  amount: number,
  error?: string
): Promise<void> {
  console.error(`[ALERT] Payment failure for user ${userId}:`, error);

  await sendSlackAlert({
    title: 'Payment Failed - Customer Action Required',
    message: `*User ID:* ${userId}\n*Email:* ${customerEmail || 'unknown'}\n*Amount:* $${(amount / 100).toFixed(2)}\n*Error:* ${error || 'Unknown'}`,
    severity: 'error',
    context: { userId, customerEmail, amount },
  });
}

/**
 * Alert for subscription issues
 */
export async function alertSubscriptionIssue(
  issue: string,
  details: Record<string, unknown>
): Promise<void> {
  console.error(`[ALERT] Subscription issue - ${issue}:`, details);

  await sendSlackAlert({
    title: `Subscription Issue: ${issue}`,
    message: `A subscription-related issue requires attention.`,
    severity: 'warning',
    context: details,
  });
}

/**
 * Send a generic alert
 */
export async function sendAlert(payload: AlertPayload): Promise<void> {
  console.log(`[ALERT] ${payload.severity.toUpperCase()}: ${payload.title} - ${payload.message}`);
  await sendSlackAlert(payload);
}
