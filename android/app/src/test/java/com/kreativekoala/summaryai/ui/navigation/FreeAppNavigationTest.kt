package com.kreativekoala.summaryai.ui.navigation

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * MeetingMind is free for everyone (owner policy), so no screen may be reachable only through a paywall.
 * Join Meeting and Phone used to detour through a FeaturePaywall for non-subscribers; these tests keep that
 * from coming back.
 */
class FreeAppNavigationTest {
    private val sources = File("src/main/java/com/kreativekoala/summaryai")

    private fun source(path: String): String {
        val f = File(sources, path)
        assertTrue("expected ${f.absolutePath} (run unit tests from the :app module)", f.exists())
        return f.readText()
    }

    @Test fun phoneAndJoinMeetingRoutesAreDirect() {
        assertEquals("phone", Screen.Phone.route)
        assertEquals("meetings/join", Screen.JoinMeeting.route)
    }

    @Test fun phoneStaysInTheBottomBar() {
        assertTrue(bottomNavItems.any { it.screen.route == Screen.Phone.route })
    }

    @Test fun noPaywallRoutesExist() {
        val navGraph = source("ui/navigation/NavGraph.kt")
        for (token in listOf("FeaturePaywall", "Screen.Paywall", "object Paywall", "PaywallScreen", "paywall/")) {
            assertFalse("NavGraph.kt must not mention $token", navGraph.contains(token))
        }
    }

    @Test fun noClientSideFeatureLockIsPassedToTheNavGraph() {
        assertFalse(source("ui/navigation/NavGraph.kt").contains("isPaidFeatureLocked"))
        assertFalse(source("MainActivity.kt").contains("isPaidFeatureLocked"))
    }

    @Test fun noUpgradeEntryPointsInSettingsOrRecordingDetail() {
        val settings = source("ui/settings/SettingsScreen.kt")
        assertFalse(settings.contains("onUpgradeClick"))
        assertFalse(settings.contains("PaywallPreview"))
        assertFalse(source("ui/recordings/RecordingDetailScreen.kt").contains("onUpgradeClick"))
    }
}
