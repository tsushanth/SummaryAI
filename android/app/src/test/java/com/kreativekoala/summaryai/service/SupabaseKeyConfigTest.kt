package com.kreativekoala.summaryai.service

import com.kreativekoala.summaryai.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The legacy Supabase anon JWT is being retired. Every build must carry the publishable key
 * (opaque string, not a JWT) and the project URL it belongs to.
 */
class SupabaseKeyConfigTest {
    @Test
    fun clientKeyIsPublishableNotLegacyJwt() {
        val key = BuildConfig.SUPABASE_PUBLISHABLE_KEY
        assertTrue("expected sb_publishable_ key", key.startsWith("sb_publishable_"))
        assertFalse("must not be a JWT", key.startsWith("eyJ"))
        assertFalse("must not contain dots (JWT shape)", key.contains('.'))
    }

    @Test
    fun projectUrlIsTheMeetingMindProject() {
        assertEquals("https://mlofjzlmncgnhxbiuemf.supabase.co", BuildConfig.SUPABASE_URL)
    }
}
