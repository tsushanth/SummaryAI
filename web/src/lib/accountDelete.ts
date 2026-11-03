/**
 * Pure helpers for the web "Delete account" flow. No runtime imports so node can load this file directly
 * (see scripts/accountDelete.test.mjs).
 */

/** The user must type this exactly before the delete button is enabled. */
export const DELETE_CONFIRM_WORD = 'DELETE';

export function isDeleteConfirmed(input: string | null | undefined): boolean {
  return typeof input === 'string' && input.trim() === DELETE_CONFIRM_WORD;
}

/**
 * DELETE /api/users/account does not cancel a Stripe subscription, so a user who still has one must cancel it
 * first (Billing). Mirrors the states in which Stripe may still charge.
 */
export function hasBillableStripeSubscription(sub: { provider?: string | null; status?: string | null } | null | undefined): boolean {
  return !!sub && sub.provider === 'stripe' && ['active', 'trialing', 'past_due'].includes(sub.status ?? '');
}

export type DeleteAccountResult = { ok: true } | { ok: false; message: string };

/**
 * Call the API, and only if it succeeds sign the browser out. The auth user no longer exists after a successful
 * delete, so a sign-out error at that point is ignored (the local session is cleared either way).
 */
export async function deleteAccountThenSignOut(deps: {
  remove: () => Promise<unknown>;
  signOut: () => Promise<unknown>;
}): Promise<DeleteAccountResult> {
  try {
    await deps.remove();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Failed to delete account' };
  }
  try {
    await deps.signOut();
  } catch {
    // Account is already gone; nothing useful to show.
  }
  return { ok: true };
}
