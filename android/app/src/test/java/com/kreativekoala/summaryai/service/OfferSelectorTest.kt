package com.kreativekoala.summaryai.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OfferSelectorTest {
    private fun free(p: String) = OfferPhase(0, p)
    private fun paid(p: String, micros: Long = 69_990_000) = OfferPhase(micros, p, "$69.99", "USD")
    private fun offer(token: String, id: String?, vararg ph: OfferPhase) = OfferCandidate(token, id, ph.toList())

    private val base = offer("base", null, paid("P1Y"))
    private val week = offer("week", "sevendayfree", free("P1W"), paid("P1Y"))
    private val month = offer("month", "mm2024promo", free("P1M"), paid("P1Y"))

    @Test fun eligibleWithWeekAndMonth_picksMonth() {
        val s = OfferSelector.select(listOf(base, week, month))!!
        assertEquals("month", s.offer.offerToken)
        assertEquals(30, s.trialDays)
        assertEquals(69_990_000L, s.paidPhase.priceAmountMicros)
    }

    @Test fun baseListedFirst_stillPicksTrial() {
        assertEquals("week", OfferSelector.select(listOf(base, week))!!.offer.offerToken)
        assertEquals(7, OfferSelector.select(listOf(base, week))!!.trialDays)
    }

    @Test fun onlySevenDayFree() {
        val s = OfferSelector.select(listOf(week))!!
        assertEquals(7, s.trialDays)
        assertEquals("P1Y", s.paidPhase.billingPeriod)
    }

    @Test fun trialPlusIntroPrice_loses_toBase_andToCleanTrial() {
        val intro = offer("intro", "intro", free("P1M"), paid("P1M", 1_990_000), paid("P1Y"))
        assertEquals("base", OfferSelector.select(listOf(intro, base))!!.offer.offerToken)
        assertEquals("week", OfferSelector.select(listOf(intro, week, base))!!.offer.offerToken)
        // nothing else exists: intro is used, trial days from its free phase, price from first paid phase
        val only = OfferSelector.select(listOf(intro))!!
        assertEquals(30, only.trialDays)
        assertEquals(1_990_000L, only.paidPhase.priceAmountMicros)
    }

    @Test fun noTrial_baseOnly() {
        val s = OfferSelector.select(listOf(base))!!
        assertNull(s.trialDays)
        assertEquals("base", s.offer.offerToken)
    }

    @Test fun noOffers() {
        assertNull(OfferSelector.select(emptyList()))
    }

    @Test fun offerWithNoPaidPhaseIgnored() {
        assertNull(OfferSelector.select(listOf(offer("x", "x", free("P1W")))))
    }

    @Test fun malformedDurations() {
        assertNull(OfferSelector.periodToDays(""))
        assertNull(OfferSelector.periodToDays("P"))
        assertNull(OfferSelector.periodToDays("7D"))
        assertNull(OfferSelector.periodToDays("PT5H"))
        assertNull(OfferSelector.periodToDays("P0D"))
        assertEquals(3, OfferSelector.periodToDays("P3D"))
        assertEquals(7, OfferSelector.periodToDays("P1W"))
        assertEquals(30, OfferSelector.periodToDays("P1M"))
        assertEquals(365, OfferSelector.periodToDays("P1Y"))
        val bad = offer("bad", "bad", free("garbage"), paid("P1Y"))
        // malformed trial is not treated as a trial; base wins, no trial text
        val s = OfferSelector.select(listOf(bad, base))!!
        assertEquals("base", s.offer.offerToken)
        assertNull(s.trialDays)
        assertNull(OfferSelector.select(listOf(bad))!!.trialDays)
    }

    @Test fun tieIsDeterministicRegardlessOfOrder() {
        val a = offer("tokA", "aaa", free("P1W"), paid("P1Y"))
        val b = offer("tokB", "bbb", free("P7D"), paid("P1Y"))
        assertEquals("tokA", OfferSelector.select(listOf(a, b))!!.offer.offerToken)
        assertEquals("tokA", OfferSelector.select(listOf(b, a))!!.offer.offerToken)
    }
}
