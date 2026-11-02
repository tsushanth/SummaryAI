package com.kreativekoala.summaryai.ui.onboarding

import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import com.kreativekoala.summaryai.ui.navigation.Screen
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FirstRunTest {
    private val sources = File("src/main/java/com/kreativekoala/summaryai")

    // ---- routing -----------------------------------------------------------------------------

    @Test fun signedOutUsersGoToAuth() {
        assertEquals(Screen.Auth.route, FirstRunRouting.target(isAuthenticated = false, hasCompletedOnboarding = false, emailMissing = false))
        assertEquals(Screen.Auth.route, FirstRunRouting.target(false, true, false))
    }

    @Test fun aNewSignedInUserLandsOnRecordWithNoSlidesAndNoEmailScreen() {
        assertEquals(Screen.Recording.route, FirstRunRouting.target(true, hasCompletedOnboarding = false, emailMissing = false))
    }

    @Test fun emailIsCollectedOnlyWhenTheAccountHasNone() {
        assertEquals(Screen.Onboarding.route, FirstRunRouting.target(true, false, emailMissing = true))
        assertTrue(FirstRunRouting.emailMissing(null))
        assertTrue(FirstRunRouting.emailMissing("  "))
        assertFalse(FirstRunRouting.emailMissing("someone@example.org"))
    }

    @Test fun returningUsersGoStraightToTheList() {
        assertEquals(Screen.Recordings.route, FirstRunRouting.target(true, true, false))
        assertEquals(Screen.Recordings.route, FirstRunRouting.target(true, true, true))
    }

    @Test fun onlyAFirstRunUserShouldBeSeeded() {
        assertTrue(FirstRunRouting.isFirstRun(isAuthenticated = true, hasCompletedOnboarding = false))
        assertFalse(FirstRunRouting.isFirstRun(true, true))
        assertFalse(FirstRunRouting.isFirstRun(false, false))
    }

    // ---- state -------------------------------------------------------------------------------

    @Test fun firstRunStateIsActiveFromBeginUntilTheFirstRecordingStarts() {
        val prefs = FakeSharedPreferences()
        val s = FirstRunState(prefs)
        assertFalse(s.active)
        s.begin()
        assertTrue(s.active)
        assertTrue("survives a restart", FirstRunState(prefs).active)
        s.finish()
        assertFalse(s.active)
        s.begin()
        assertFalse("never restarts once finished", s.active)
    }

    // ---- the old first-run friction must not come back ---------------------------------------

    @Test fun theFourSlidePagerIsGone() {
        val onboarding = File(sources, "ui/onboarding/OnboardingScreen.kt").readText()
        assertFalse(onboarding.contains("HorizontalPager"))
        assertFalse(onboarding.contains("onboarding_recording_title"))
        assertFalse(File(sources, "ui/onboarding/OnboardingViewModel.kt").exists())
    }

    @Test fun theEmailScreenIsOnlyReachableWhenEmailIsMissing() {
        val nav = File(sources, "ui/navigation/NavGraph.kt").readText()
        assertTrue(nav.contains("FirstRunRouting.target"))
        // OnboardingScreen is the email-only screen now
        assertTrue(File(sources, "ui/onboarding/OnboardingScreen.kt").readText().contains("EmailCaptureScreen"))
    }

    @Test fun noBillingOrPaywallCodeWasReintroduced() {
        val nav = File(sources, "ui/navigation/NavGraph.kt").readText()
        for (token in listOf("Paywall", "paywall", "isPaidFeatureLocked")) assertFalse(nav.contains(token))
    }
}
