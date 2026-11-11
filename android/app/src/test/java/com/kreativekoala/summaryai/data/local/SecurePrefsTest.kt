package com.kreativekoala.summaryai.data.local

import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.GeneralSecurityException

class SecurePrefsTest {

    @Test fun opensNormally() {
        val store = FakeSharedPreferences()
        var wipes = 0
        assertSame(store, SecurePrefs.create(factory = { store }, wipe = { wipes++ }))
        assertEquals(0, wipes)
    }

    @Test fun wipesAndRetriesOnceWhenTheFirstOpenFails() {
        val store = FakeSharedPreferences()
        var opens = 0
        var wipes = 0
        val result = SecurePrefs.create(
            factory = { if (opens++ == 0) throw GeneralSecurityException("key lost") else store },
            wipe = { wipes++ },
        )
        assertSame(store, result)
        assertEquals(1, wipes)
        assertEquals(2, opens)
    }

    @Test fun neverThrowsAndNeverTouchesDiskWhenEncryptionIsUnavailable() {
        var wipes = 0
        val result = SecurePrefs.create(
            factory = { throw GeneralSecurityException("keystore broken") },
            wipe = { wipes++; throw IllegalStateException("cannot reset") },
        )
        assertEquals(1, wipes)
        // signed-out, in-memory only: usable, but empty
        assertNull(result.getString("access_token", null))
        result.edit().putString("access_token", "x").commit()
        assertEquals("x", result.getString("access_token", null))
        assertTrue(result is MemorySharedPreferences)
    }
}
