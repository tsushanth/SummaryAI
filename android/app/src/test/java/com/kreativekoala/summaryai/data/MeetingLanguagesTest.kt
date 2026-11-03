package com.kreativekoala.summaryai.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MeetingLanguagesTest {
    @Test fun autoAndJunkNormalizeToAuto() {
        assertEquals("auto", MeetingLanguages.normalize(null))
        assertEquals("auto", MeetingLanguages.normalize(""))
        assertEquals("auto", MeetingLanguages.normalize("  "))
        assertEquals("auto", MeetingLanguages.normalize("AUTO"))
        assertEquals("auto", MeetingLanguages.normalize("xx"))
        assertEquals("auto", MeetingLanguages.normalize("klingon"))
    }

    @Test fun regionTagsReduceToThePrimarySubtag() {
        assertEquals("es", MeetingLanguages.normalize("es-MX"))
        assertEquals("pt", MeetingLanguages.normalize("pt_BR"))
        assertEquals("zh", MeetingLanguages.normalize("zh-CN"))
        assertEquals("en", MeetingLanguages.normalize(" EN "))
    }

    @Test fun autoIsOmittedFromRequests() {
        assertNull(MeetingLanguages.toRequestValue("auto"))
        assertNull(MeetingLanguages.toRequestValue(null))
        assertNull(MeetingLanguages.toRequestValue("not-a-language"))
        assertEquals("hi", MeetingLanguages.toRequestValue("hi"))
    }

    @Test fun listHasUniqueLowercasePrimarySubtagsAndNames() {
        val codes = MeetingLanguages.options.map { it.code }
        assertEquals(codes.size, codes.toSet().size)
        assertTrue(codes.all { it == it.lowercase() && '-' !in it && '_' !in it && it != "auto" })
        assertTrue(MeetingLanguages.options.all { it.nativeName.isNotBlank() })
        assertTrue("en" in codes)
    }

    @Test fun nativeNameIsNullForAuto() {
        assertNull(MeetingLanguages.nativeName("auto"))
        assertEquals("Español", MeetingLanguages.nativeName("es"))
        assertFalse(MeetingLanguages.isAuto("es"))
        assertTrue(MeetingLanguages.isAuto(null))
    }
}
