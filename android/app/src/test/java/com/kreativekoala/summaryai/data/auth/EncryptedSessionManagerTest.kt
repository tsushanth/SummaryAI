package com.kreativekoala.summaryai.data.auth

import android.content.SharedPreferences
import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import com.kreativekoala.summaryai.BuildConfig
import com.russhwolf.settings.SharedPreferencesSettings
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.gotrue.MemoryCodeVerifierCache
import io.github.jan.supabase.gotrue.SettingsSessionManager
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.user.UserInfo
import io.github.jan.supabase.gotrue.user.UserSession
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.datetime.Clock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.security.GeneralSecurityException
import kotlin.time.Duration.Companion.hours

class EncryptedSessionManagerTest {

    private lateinit var secure: FakeSharedPreferences
    private lateinit var legacy: FakeSharedPreferences
    private lateinit var manager: EncryptedSessionManager

    private val session = UserSession(
        accessToken = "access-token-AAA",
        refreshToken = "refresh-token-RRR",
        providerRefreshToken = null,
        providerToken = null,
        expiresIn = 3600,
        tokenType = "bearer",
        user = UserInfo(aud = "authenticated", id = "user-1234567890", email = "someone@example.com"),
        type = "",
        expiresAt = Clock.System.now() + 1.hours,
    )

    @Before fun setUp() {
        secure = FakeSharedPreferences()
        legacy = FakeSharedPreferences()
        manager = EncryptedSessionManager(secure, legacy)
    }

    /** The key the stock manager really used on 1.7.9 devices (observed on a device: sb-<project>-supabase-co-session). */
    private val realKey = "sb-mlofjzlmncgnhxbiuemf-supabase-co-session"

    /**
     * Writes the session exactly the way the app's stock supabase-kt manager did on 1.7.9: clear text, in the default
     * prefs file, through the library's own SettingsSessionManager under the library's real key.
     */
    private fun writeLegacy(s: UserSession) = runBlocking {
        SettingsSessionManager(SharedPreferencesSettings(legacy), realKey).saveSession(s)
    }

    /** What a very old install (or the library before it renamed the entry) holds: the plain key "session". */
    private fun writeVeryOldLegacy(s: UserSession) = runBlocking {
        SettingsSessionManager(SharedPreferencesSettings(legacy), EncryptedSessionManager.LEGACY_KEY).saveSession(s)
    }

    /** True when ANY clear-text session entry is left in the default prefs file. */
    private fun plaintextLeft(): Boolean =
        legacy.contains(realKey) || legacy.contains(EncryptedSessionManager.LEGACY_KEY) ||
            legacy.all.keys.any { it.endsWith("-session") || it == "session" }

    @Test fun libraryKeyMatchesTheKeyObservedOnDevice() {
        assertEquals(realKey, EncryptedSessionManager.libraryKeyFor(BuildConfig.SUPABASE_URL))
        assertEquals(realKey, EncryptedSessionManager.libraryKeyFor("mlofjzlmncgnhxbiuemf.supabase.co/"))
    }

    private fun assertSame(expected: UserSession, actual: UserSession?) {
        assertNotNull(actual)
        assertEquals(expected.accessToken, actual!!.accessToken)
        assertEquals(expected.refreshToken, actual.refreshToken)
        assertEquals(expected.expiresIn, actual.expiresIn)
        assertEquals(expected.expiresAt, actual.expiresAt)
        assertEquals(expected.user?.id, actual.user?.id)
        assertEquals(expected.user?.email, actual.user?.email)
    }

    @Test fun roundTripThroughTheEncryptedStore() = runBlocking {
        assertNull(manager.loadSession())
        manager.saveSession(session)
        assertTrue(secure.contains(EncryptedSessionManager.SECURE_KEY))
        assertFalse("nothing is written to the clear-text file", legacy.all.isNotEmpty())
        assertSame(session, manager.loadSession())
        // a fresh manager over the same store (process restart) still sees it
        assertSame(session, EncryptedSessionManager(secure, legacy).loadSession())
    }

    @Test fun deleteRemovesBothCopies() = runBlocking {
        writeLegacy(session)
        manager.saveSession(session)
        manager.deleteSession()
        assertFalse(secure.contains(EncryptedSessionManager.SECURE_KEY))
        assertFalse(plaintextLeft())
        assertNull(manager.loadSession())
    }

    @Test fun migratesAClearTextSessionAndWipesIt() = runBlocking {
        writeLegacy(session)
        assertTrue(legacy.contains(realKey))

        val loaded = manager.loadSession()

        assertSame(session, loaded) // the user stays signed in
        assertTrue("now in the encrypted store", secure.contains(EncryptedSessionManager.SECURE_KEY))
        assertFalse("clear-text copy wiped", plaintextLeft())
        assertSame(session, manager.loadSession()) // and the second launch reads the encrypted copy
    }

    @Test fun migratesASessionHeldUnderTheVeryOldPlainKey() = runBlocking {
        writeVeryOldLegacy(session)
        assertTrue(legacy.contains(EncryptedSessionManager.LEGACY_KEY))
        assertSame(session, manager.loadSession())
        assertTrue(secure.contains(EncryptedSessionManager.SECURE_KEY))
        assertFalse(plaintextLeft())
    }

    @Test fun wipesBothClearTextKeysAfterMigrating() = runBlocking {
        writeLegacy(session)
        writeVeryOldLegacy(session)
        assertTrue(legacy.contains(realKey) && legacy.contains(EncryptedSessionManager.LEGACY_KEY))
        assertSame(session, manager.loadSession())
        assertFalse("sb-... entry wiped", legacy.contains(realKey))
        assertFalse("plain entry wiped", legacy.contains(EncryptedSessionManager.LEGACY_KEY))
        assertFalse(plaintextLeft())
    }

    @Test fun anUnreadableLibraryEntryDoesNotHideAReadablePlainOne() = runBlocking {
        legacy.edit().putString(realKey, "not json").commit()
        writeVeryOldLegacy(session)
        assertSame(session, manager.loadSession())
        assertFalse(plaintextLeft())
    }

    @Test fun savingNeverLeavesAClearTextCopyBehind() = runBlocking {
        writeLegacy(session)
        manager.saveSession(session)
        assertFalse(plaintextLeft())
        assertTrue(secure.contains(EncryptedSessionManager.SECURE_KEY))
    }

    @Test fun leftoverClearTextCopyIsRemovedWhenEncryptedOneExists() = runBlocking {
        manager.saveSession(session)
        legacy.edit().putString(realKey, "{\"stale\":true}").commit()
        assertSame(session, manager.loadSession())
        assertFalse(plaintextLeft())
    }

    @Test fun unreadableClearTextSessionMeansSignedOutAndIsWiped() = runBlocking {
        legacy.edit().putString(realKey, "not json").commit()
        assertNull(manager.loadSession())
        assertFalse(plaintextLeft())
        assertFalse(secure.contains(EncryptedSessionManager.SECURE_KEY))
    }

    @Test fun corruptEncryptedSessionMeansSignedOut() = runBlocking {
        secure.edit().putString(EncryptedSessionManager.SECURE_KEY, "garbage").commit()
        assertNull(manager.loadSession())
        assertFalse("bad value dropped", secure.contains(EncryptedSessionManager.SECURE_KEY))
    }

    /** SharedPreferences whose every access throws, like EncryptedSharedPreferences after the Keystore key is lost. */
    private class BrokenPrefs : SharedPreferences by FakeSharedPreferences() {
        override fun getString(key: String, defValue: String?): String? = throw GeneralSecurityException("keystore")
        override fun contains(key: String): Boolean = throw GeneralSecurityException("keystore")
        override fun edit(): SharedPreferences.Editor = throw GeneralSecurityException("keystore")
    }

    @Test fun brokenEncryptedStoreFallsBackToSignedOutWithoutCrashing() = runBlocking {
        val broken = EncryptedSessionManager(BrokenPrefs(), legacy)
        assertNull(broken.loadSession())
        broken.saveSession(session) // must not throw
        broken.deleteSession() // must not throw
        assertNull(broken.loadSession())
    }

    @Test fun brokenEncryptedStoreKeepsTheClearTextSessionForARetryButStillSignsIn() = runBlocking {
        writeLegacy(session)
        val broken = EncryptedSessionManager(BrokenPrefs(), legacy)
        assertSame(session, broken.loadSession())
        assertTrue("kept so the next launch can finish the migration", legacy.contains(realKey))
        // next launch, store healthy again
        assertSame(session, EncryptedSessionManager(secure, legacy).loadSession())
        assertFalse(plaintextLeft())
    }

    @Test fun brokenLegacyFileIsNotACrash() = runBlocking {
        val m = EncryptedSessionManager(secure, BrokenPrefs())
        assertNull(m.loadSession())
        m.saveSession(session)
        assertSame(session, m.loadSession())
    }

    /** End to end through the real supabase-kt client: a user upgrading with a clear-text session is still signed in. */
    @Test fun realClientRestoresTheMigratedSession() {
        writeLegacy(session)
        val client = createSupabaseClient(
            supabaseUrl = "http://127.0.0.1:1", // never contacted: the session is far from expiry
            supabaseKey = "sb_publishable_test_key"
        ) {
            install(Auth) {
                sessionManager = manager
                codeVerifierCache = MemoryCodeVerifierCache()
                enableLifecycleCallbacks = false
                alwaysAutoRefresh = false
            }
        }
        runBlocking { withTimeout(10_000) { client.auth.awaitInitialization() } }
        assertSame(session, client.auth.currentSessionOrNull())
        assertFalse(plaintextLeft())
        assertTrue(secure.contains(EncryptedSessionManager.SECURE_KEY))
        runBlocking { client.auth.clearSession() }
        assertFalse(secure.contains(EncryptedSessionManager.SECURE_KEY))
    }
}
