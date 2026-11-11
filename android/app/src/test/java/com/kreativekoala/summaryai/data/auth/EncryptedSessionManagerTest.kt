package com.kreativekoala.summaryai.data.auth

import android.content.SharedPreferences
import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
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

    /** Writes the session exactly the way supabase-kt's stock manager did (clear text, key "session", default prefs file). */
    private fun writeLegacy(s: UserSession) = runBlocking {
        SettingsSessionManager(SharedPreferencesSettings(legacy)).saveSession(s)
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
        assertFalse(legacy.contains(EncryptedSessionManager.LEGACY_KEY))
        assertNull(manager.loadSession())
    }

    @Test fun migratesAClearTextSessionAndWipesIt() = runBlocking {
        writeLegacy(session)
        assertTrue(legacy.contains(EncryptedSessionManager.LEGACY_KEY))

        val loaded = manager.loadSession()

        assertSame(session, loaded) // the user stays signed in
        assertTrue("now in the encrypted store", secure.contains(EncryptedSessionManager.SECURE_KEY))
        assertFalse("clear-text copy wiped", legacy.contains(EncryptedSessionManager.LEGACY_KEY))
        assertSame(session, manager.loadSession()) // and the second launch reads the encrypted copy
    }

    @Test fun leftoverClearTextCopyIsRemovedWhenEncryptedOneExists() = runBlocking {
        manager.saveSession(session)
        legacy.edit().putString(EncryptedSessionManager.LEGACY_KEY, "{\"stale\":true}").commit()
        assertSame(session, manager.loadSession())
        assertFalse(legacy.contains(EncryptedSessionManager.LEGACY_KEY))
    }

    @Test fun unreadableClearTextSessionMeansSignedOutAndIsWiped() = runBlocking {
        legacy.edit().putString(EncryptedSessionManager.LEGACY_KEY, "not json").commit()
        assertNull(manager.loadSession())
        assertFalse(legacy.contains(EncryptedSessionManager.LEGACY_KEY))
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
        assertTrue("kept so the next launch can finish the migration", legacy.contains(EncryptedSessionManager.LEGACY_KEY))
        // next launch, store healthy again
        assertSame(session, EncryptedSessionManager(secure, legacy).loadSession())
        assertFalse(legacy.contains(EncryptedSessionManager.LEGACY_KEY))
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
        assertFalse(legacy.contains(EncryptedSessionManager.LEGACY_KEY))
        assertTrue(secure.contains(EncryptedSessionManager.SECURE_KEY))
        runBlocking { client.auth.clearSession() }
        assertFalse(secure.contains(EncryptedSessionManager.SECURE_KEY))
    }
}
