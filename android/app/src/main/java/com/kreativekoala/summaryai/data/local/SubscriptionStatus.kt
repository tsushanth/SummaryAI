package com.kreativekoala.summaryai.data.local

import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Process-wide flag that mirrors the user's local Play Billing subscription state.
 * BillingManager writes to it; AuthInterceptor reads it to stamp every authenticated
 * request with `x-subscription-active: true` when the user has an active subscription.
 *
 * The backend trusts this header as one of several subscription signals (alongside
 * the profiles/subscriptions tables that get populated by Play RTDN webhooks).
 */
@Singleton
class SubscriptionStatus @Inject constructor() {
    private val active = AtomicBoolean(false)

    fun setActive(value: Boolean) {
        active.set(value)
    }

    val isActive: Boolean get() = active.get()
}
