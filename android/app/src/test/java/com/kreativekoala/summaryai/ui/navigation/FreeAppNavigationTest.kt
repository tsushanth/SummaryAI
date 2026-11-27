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

    @Test fun phoneIsNotInTheBottomBarUnlessTheServerSaysSo() {
        assertEquals(
            listOf("recordings", "meetings", "recording", "settings"),
            bottomNavItems(phoneEnabled = false).map { it.screen.route },
        )
        assertEquals(
            listOf("recordings", "meetings", "recording", "phone", "settings"),
            bottomNavItems(phoneEnabled = true).map { it.screen.route },
        )
    }

    /** The route stays registered (a restored back stack must not crash), but the screen is only built when allowed. */
    @Test fun thePhoneScreenIsOnlyComposedWhenTheServerAllowsIt() {
        val navGraph = source("ui/navigation/NavGraph.kt")
        val route = navGraph.substringAfter("composable(Screen.Phone.route)").substringBefore("// Settings")
        assertTrue("PhoneScreen must sit inside the check", route.indexOf("if (phoneEnabled)") in 0 until route.indexOf("PhoneScreen("))
        assertTrue("otherwise the route must lead to the recordings list", route.contains("navController.navigate(Screen.Recordings.route)"))
        assertEquals("PhoneScreen is used in one place only", 1, Regex("\\bPhoneScreen\\(").findAll(navGraph).count())
    }

    /** Calling uses the permissions recording already has: nothing phone-specific is declared. */
    @Test fun noPhoneOnlyPermissions() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        for (token in listOf("FOREGROUND_SERVICE_PHONE_CALL", "MANAGE_OWN_CALLS", "READ_PHONE_STATE", "CALL_PHONE", "READ_CONTACTS", "android.hardware.telephony", "READ_MEDIA_")) {
            assertFalse("AndroidManifest.xml must not declare $token", manifest.contains(token))
        }
        for (kept in listOf("RECORD_AUDIO", "FOREGROUND_SERVICE_MICROPHONE", "FOREGROUND_SERVICE_MEDIA_PLAYBACK", "FOREGROUND_SERVICE_DATA_SYNC")) {
            assertTrue("recording, calls and playback need $kept", manifest.contains("android.permission.$kept\""))
        }
    }

    /** A call is placed only from the consent screen. */
    @Test fun everyCallPathGoesThroughTheConsentScreen() {
        val viewModel = source("ui/phone/PhoneViewModel.kt")
        assertEquals("the server is asked for a call in one place", 1, Regex("repository\\.startCall\\(").findAll(viewModel).count())
        assertTrue(viewModel.substringAfter("fun acceptConsent()").substringBefore("fun microphoneRefused").contains("repository.startCall("))
        val screen = source("ui/phone/PhoneScreen.kt")
        assertTrue(screen.contains("RecordingConsentDialog("))
        val accepted = screen.substringBefore("RecordingConsentDialog(")
        assertFalse("nothing before the consent dialog accepts it except the permission answer", Regex("viewModel::acceptConsent").containsMatchIn(accepted))
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
