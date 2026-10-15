package com.kreativekoala.summaryai.service

/** One pricing phase of a Play subscription offer (no Play types, so it is JVM-testable). */
data class OfferPhase(
    val priceAmountMicros: Long,
    val billingPeriod: String,
    val formattedPrice: String = "",
    val priceCurrencyCode: String = "",
)

/** One offer Google Play returned for the user (Play only returns offers the user is eligible for). */
data class OfferCandidate(
    val offerToken: String,
    val offerId: String?,
    val phases: List<OfferPhase>,
)

data class SelectedOffer(
    val offer: OfferCandidate,
    /** Length of the free phase in days, or null when the chosen offer has no free trial. */
    val trialDays: Int?,
    /** First non-free phase: the price Google Play charges once any trial ends. */
    val paidPhase: OfferPhase,
)

object OfferSelector {

    /** ISO-8601 duration (P3D, P1W, P1M, P1Y, combinations) to days; 1M = 30d, 1Y = 365d. Null if malformed or zero. */
    fun periodToDays(period: String): Int? {
        val m = Regex("^P(?:(\\d+)Y)?(?:(\\d+)M)?(?:(\\d+)W)?(?:(\\d+)D)?$").matchEntire(period) ?: return null
        if (m.groupValues.drop(1).all { it.isEmpty() }) return null
        val (y, mo, w, d) = m.groupValues.drop(1).map { it.toLongOrNull() ?: 0L }
        val days = y * 365 + mo * 30 + w * 7 + d
        return if (days in 1..Int.MAX_VALUE) days.toInt() else null
    }

    private fun freeDays(offer: OfferCandidate): Int? =
        offer.phases.firstOrNull { it.priceAmountMicros == 0L }?.let { periodToDays(it.billingPeriod) }

    private val OfferCandidate.hasPaidPhase get() = phases.any { it.priceAmountMicros > 0 }

    /**
     * Preference order:
     *  1. clean free trial (free phase then the regular price, no paid intro phase), longest trial first
     *  2. plain base-plan offer (single paid phase)
     *  3. anything else (paid intro phases, unparseable trials), longest trial first
     * Ties are broken deterministically by offerId then offerToken. Null if no offer has a paid phase.
     */
    fun select(offers: List<OfferCandidate>): SelectedOffer? {
        val usable = offers.filter { it.hasPaidPhase }
        fun tier(o: OfferCandidate): Int {
            val paid = o.phases.count { it.priceAmountMicros > 0 }
            val free = o.phases.count { it.priceAmountMicros == 0L }
            return when {
                free == 1 && paid == 1 && freeDays(o) != null -> 0
                free == 0 && paid == 1 -> 1
                else -> 2
            }
        }
        val best = usable.sortedWith(
            compareBy<OfferCandidate> { tier(it) }
                .thenByDescending { freeDays(it) ?: 0 }
                .thenBy { it.offerId ?: "" }
                .thenBy { it.offerToken }
        ).firstOrNull() ?: return null
        val paidPhase = best.phases.first { it.priceAmountMicros > 0 }
        return SelectedOffer(best, freeDays(best), paidPhase)
    }
}
