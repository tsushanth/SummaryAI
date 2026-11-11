package com.kreativekoala.summaryai.data.local

import android.content.SharedPreferences
import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.GeneralSecurityException

class TokenManagerTest {

    @Test fun roundTripAndClear() {
        val tm = TokenManager(FakeSharedPreferences())
        assertFalse(tm.isLoggedIn)
        tm.saveTokens("acc", "ref", System.currentTimeMillis() + 60_000, "user-12345678")
        assertTrue(tm.isLoggedIn)
        assertFalse(tm.isTokenExpired)
        assertEquals("acc", tm.accessToken)
        assertEquals("ref", tm.refreshToken)
        assertEquals("user-12345678", tm.userId)
        tm.clearTokens()
        assertFalse(tm.isLoggedIn)
        assertNull(tm.refreshToken)
    }

    private class BrokenPrefs : SharedPreferences by FakeSharedPreferences() {
        override fun getString(key: String, defValue: String?): String? = throw GeneralSecurityException("keystore")
        override fun getLong(key: String, defValue: Long): Long = throw GeneralSecurityException("keystore")
        override fun edit(): SharedPreferences.Editor = throw GeneralSecurityException("keystore")
    }

    @Test fun brokenStoreIsSignedOutNotACrash() {
        val tm = TokenManager(BrokenPrefs()) // init reads the user id: must not throw
        assertFalse(tm.isLoggedIn)
        assertNull(tm.accessToken)
        assertTrue(tm.isTokenExpired)
        tm.saveTokens("acc", "ref", 1L, "user-12345678") // dropped, no throw
        tm.clearTokens()
    }
}
