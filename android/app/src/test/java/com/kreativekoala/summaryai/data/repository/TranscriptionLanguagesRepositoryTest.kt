package com.kreativekoala.summaryai.data.repository

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.google.gson.Gson
import com.kreativekoala.summaryai.data.LanguageCatalog
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.DefaultLanguageRequest
import com.kreativekoala.summaryai.data.api.models.TranscriptionLanguagesResponse
import com.kreativekoala.summaryai.data.local.PreferencesManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import retrofit2.Response
import java.io.File
import java.lang.reflect.Proxy

class TranscriptionLanguagesRepositoryTest {
    @get:Rule val tmp = TemporaryFolder()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val gson = Gson()
    private val json = "application/json".toMediaType()

    @After fun tearDown() = scope.cancel()

    private val serverBody = """
        {"auto":"auto","default_language":"es","languages":[
          {"code":"bg","name":"Bulgarian","native":"Български"},
          {"code":"en","name":"English","native":"English"},
          {"code":"es","name":"Spanish","native":"Español"}],
         "live":{"provider":"recall","can_change_during_meeting":false,"english_only_low_latency":true,
                 "non_english_live_delay_minutes":"3-10","auto_live_behaviour":"english_low_latency"}}
    """.trimIndent()

    private fun prefs() = PreferencesManager(
        PreferenceDataStoreFactory.create(scope = scope) { File(tmp.root, "p.preferences_pb") }
    )

    private fun fakeApi(handler: (String, List<Any?>) -> Any?): SummaryAIApi =
        Proxy.newProxyInstance(SummaryAIApi::class.java.classLoader, arrayOf(SummaryAIApi::class.java)) { _, m, args ->
            handler(m.name, (args ?: emptyArray()).dropLast(1))
        } as SummaryAIApi

    @Test fun parsesTheBackendBody() {
        val c = gson.fromJson(serverBody, TranscriptionLanguagesResponse::class.java).toCatalog()!!
        assertEquals(listOf("bg", "en", "es"), c.languages.map { it.code })
        assertEquals("Български", c.languages[0].nativeName)
        assertEquals("es", c.defaultLanguage)
        assertEquals("recall", c.provider)
        assertTrue(c.englishOnlyLowLatency)
        assertEquals("3-10", c.delayMinutes)
        assertTrue(c.fromServer)
        assertTrue(c.contains("bg"))
        assertFalse(c.contains("ar"))
    }

    @Test fun emptyListIsNotTrusted() {
        assertNull(gson.fromJson("""{"languages":[]}""", TranscriptionLanguagesResponse::class.java).toCatalog())
        assertNull(gson.fromJson("{}", TranscriptionLanguagesResponse::class.java).toCatalog())
    }

    @Test fun refresh_usesServerList_thenCachesInMemoryWithinTtl() = runBlocking {
        var calls = 0
        val repo = TranscriptionLanguagesRepository(
            fakeApi { _, _ -> calls++; gson.fromJson(serverBody, TranscriptionLanguagesResponse::class.java) }, prefs()
        )
        assertFalse(repo.catalog.value.fromServer)
        val first = repo.refresh(nowMs = 1_000)
        assertTrue(first.fromServer)
        repo.refresh(nowMs = 2_000)
        assertEquals(1, calls)
        repo.refresh(nowMs = 1_000 + 11 * 60 * 1000)
        assertEquals(2, calls)
    }

    @Test fun refresh_failureFallsBackToTheShortBuiltInList() = runBlocking {
        val repo = TranscriptionLanguagesRepository(fakeApi { _, _ -> throw IllegalStateException("offline") }, prefs())
        val c = repo.refresh()
        assertFalse(c.fromServer)
        assertEquals(LanguageCatalog.FALLBACK.languages, c.languages)
        assertFalse(c.contains("ar"))
    }

    @Test fun refresh_failureUsesTheLastGoodServerBodyFromDisk() = runBlocking {
        val p = prefs()
        val ok = TranscriptionLanguagesRepository(fakeApi { _, _ -> gson.fromJson(serverBody, TranscriptionLanguagesResponse::class.java) }, p)
        ok.refresh()
        // new process: empty memory, no network
        val offline = TranscriptionLanguagesRepository(fakeApi { _, _ -> throw IllegalStateException("offline") }, p)
        val c = offline.refresh()
        assertTrue(c.fromServer)
        assertEquals(listOf("bg", "en", "es"), c.languages.map { it.code })
    }

    @Test fun saveDefault_putsNormalizedCode_andUpdatesTheCatalog() = runBlocking {
        var put: DefaultLanguageRequest? = null
        val repo = TranscriptionLanguagesRepository(
            fakeApi { m, args ->
                if (m == "setDefaultTranscriptionLanguage") {
                    put = args[0] as DefaultLanguageRequest
                    Response.success("""{"default_language":"fr"}""".toResponseBody(json))
                } else gson.fromJson(serverBody, TranscriptionLanguagesResponse::class.java)
            }, prefs()
        )
        repo.refresh()
        assertTrue(repo.saveDefault("fr-CA"))
        assertEquals("fr", put?.language)
        assertEquals("fr", repo.catalog.value.defaultLanguage)
    }

    @Test fun saveDefault_failureIsReportedNotThrown() = runBlocking {
        val p = prefs()
        val repo = TranscriptionLanguagesRepository(
            fakeApi { _, _ -> Response.error<ResponseBody>(400, """{"error":{"code":"BAD_REQUEST"}}""".toResponseBody(json)) }, p
        )
        assertFalse(repo.saveDefault("es"))
        val thrower = TranscriptionLanguagesRepository(fakeApi { _, _ -> throw IllegalStateException("x") }, p)
        assertFalse(thrower.saveDefault("es"))
        assertNotNull(thrower.catalog.value)
    }
}
