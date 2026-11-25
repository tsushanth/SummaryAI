package com.kreativekoala.summaryai.ui.navigation

import com.kreativekoala.summaryai.util.FeatureFlags
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

    @Test fun phoneCallsAreSwitchedOff() {
        assertFalse(FeatureFlags.PHONE_CALLS)
    }

    @Test fun phoneIsNotInTheBottomBarWhilePhoneCallsAreOff() {
        assertEquals(
            listOf("recordings", "meetings", "recording", "settings"),
            bottomNavItems.map { it.screen.route },
        )
    }

    /** The route stays registered (a restored back stack must not crash), but the screen is only built behind the flag. */
    @Test fun thePhoneScreenIsOnlyComposedBehindTheFlag() {
        val navGraph = source("ui/navigation/NavGraph.kt")
        val route = navGraph.substringAfter("composable(Screen.Phone.route)").substringBefore("// Settings")
        assertTrue("PhoneScreen must sit inside the flag check", route.indexOf("if (FeatureFlags.PHONE_CALLS)") in 0 until route.indexOf("PhoneScreen("))
        assertTrue("with the flag off the route must lead to the recordings list", route.contains("navController.navigate(Screen.Recordings.route)"))
        assertEquals("PhoneScreen is used in one place only", 1, Regex("\\bPhoneScreen\\(").findAll(navGraph).count())
    }

    @Test fun noServiceDescriptionMentionsPhoneCalls() {
        val english = File("src/main/res/values/strings.xml").readText()
        for (name in listOf("service_description_recording", "service_description_playback")) {
            val text = english.substringAfter("name=\"$name\">").substringBefore("</string>")
            assertFalse("$name mentions calls: $text", text.contains("call", ignoreCase = true))
        }
    }

    /** Nothing but the switched-off phone feature used these; declaring them would claim a use Play cannot see. */
    @Test fun noPhoneOnlyPermissionsWhilePhoneCallsAreOff() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        for (token in listOf("FOREGROUND_SERVICE_PHONE_CALL", "MANAGE_OWN_CALLS", "READ_PHONE_STATE", "android.hardware.telephony")) {
            assertFalse("AndroidManifest.xml must not declare $token", manifest.contains(token))
        }
        for (kept in listOf("RECORD_AUDIO", "FOREGROUND_SERVICE_MICROPHONE", "FOREGROUND_SERVICE_MEDIA_PLAYBACK", "FOREGROUND_SERVICE_DATA_SYNC")) {
            assertTrue("recording and playback still need $kept", manifest.contains("android.permission.$kept\""))
        }
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

    @Test fun noProBadgeOnTheRecordingsList() {
        val list = source("ui/recordings/RecordingsListScreen.kt")
        assertFalse(list.contains("R.string.pro"))
    }
}
