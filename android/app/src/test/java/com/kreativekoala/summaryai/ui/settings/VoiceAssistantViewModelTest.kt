package com.kreativekoala.summaryai.ui.settings

import com.google.gson.Gson
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.VoiceAssistantRequest
import com.kreativekoala.summaryai.data.api.models.VoiceAssistantResponse
import com.kreativekoala.summaryai.data.repository.VoiceAssistantRepository
import com.kreativekoala.summaryai.data.repository.switchOn
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.lang.reflect.Proxy

class VoiceAssistantViewModelTest {
    private val gson = Gson()

    /** Fake API: [get] answers GET, [put] answers PUT (receives the request); either may throw. */
    private fun vm(
        get: () -> VoiceAssistantResponse,
        put: (VoiceAssistantRequest) -> VoiceAssistantResponse = { error("unexpected PUT") },
    ): VoiceAssistantViewModel {
        val api = Proxy.newProxyInstance(SummaryAIApi::class.java.classLoader, arrayOf(SummaryAIApi::class.java)) { _, m, args ->
            when (m.name) {
                "getVoiceAssistant" -> get()
                "setVoiceAssistant" -> put(args!![0] as VoiceAssistantRequest)
                else -> error("unexpected call ${m.name}")
            }
        } as SummaryAIApi
        return VoiceAssistantViewModel(VoiceAssistantRepository(api))
    }

    private fun body(json: String) = gson.fromJson(json, VoiceAssistantResponse::class.java)

    @Test fun backendBody_neverSet_modeAll_isOn() {
        assertTrue(body("""{"enabled":true,"reason":"enabled","preference":null,"mode":"all"}""").switchOn())
    }

    @Test fun backendBody_optedOut_isOff() {
        assertFalse(body("""{"enabled":false,"reason":"user_opted_out","preference":false,"mode":"all"}""").switchOn())
    }

    @Test fun backendBody_killedWithNoChoice_readsOffButAKillWithAnOptInStaysOn() {
        assertFalse(body("""{"enabled":false,"reason":"mode_off","preference":null,"mode":"off"}""").switchOn())
        assertTrue(body("""{"enabled":false,"reason":"killed","preference":true,"mode":"opt_in"}""").switchOn())
    }

    @Test fun load_success_setsSwitchAndStopsLoading() = runBlocking {
        val v = vm(get = { body("""{"enabled":false,"reason":"user_opted_out","preference":false,"mode":"all"}""") })
        assertTrue(v.state.value.loading)
        v.load()
        assertFalse(v.state.value.loading)
        assertFalse(v.state.value.loadFailed)
        assertFalse(v.state.value.enabled)
    }

    @Test fun load_offline_showsErrorAndDoesNotCrash_thenRetrySucceeds() = runBlocking {
        var offline = true
        val v = vm(get = { if (offline) throw IOException("offline") else body("""{"enabled":true,"preference":null,"mode":"all"}""") })
        v.load()
        assertTrue(v.state.value.loadFailed)
        assertFalse(v.state.value.loading)
        offline = false
        v.load()
        assertFalse(v.state.value.loadFailed)
        assertTrue(v.state.value.enabled)
    }

    @Test fun save_off_sendsEnabledFalse_andKeepsItOff() = runBlocking {
        val sent = mutableListOf<Boolean>()
        val v = vm(
            get = { body("""{"enabled":true,"preference":null,"mode":"all"}""") },
            put = { sent += it.enabled; body("""{"enabled":false,"reason":"user_opted_out","preference":false,"mode":"all"}""") },
        )
        v.load()
        v.save(false)
        assertEquals(listOf(false), sent)
        assertFalse(v.state.value.enabled)
        assertFalse(v.state.value.saving)
        assertFalse(v.state.value.saveFailed)
    }

    @Test fun save_failure_rollsBackAndShowsError() = runBlocking {
        val v = vm(
            get = { body("""{"enabled":true,"preference":null,"mode":"all"}""") },
            put = { throw IOException("offline") },
        )
        v.load()
        v.save(false)
        assertTrue(v.state.value.enabled) // back to what the server has
        assertFalse(v.state.value.saving)
        assertTrue(v.state.value.saveFailed)
    }

    @Test fun save_afterFailure_clearsTheErrorOnTheNextTry() = runBlocking {
        var fail = true
        val v = vm(
            get = { body("""{"enabled":true,"preference":null,"mode":"all"}""") },
            put = { if (fail) throw IOException("offline") else body("""{"enabled":false,"preference":false,"mode":"all"}""") },
        )
        v.load()
        v.save(false)
        assertTrue(v.state.value.saveFailed)
        fail = false
        v.save(false)
        assertFalse(v.state.value.saveFailed)
        assertFalse(v.state.value.enabled)
    }

    @Test fun save_isIgnoredWhileLoadingOrAfterAFailedLoad() = runBlocking {
        var puts = 0
        val v = vm(get = { throw IOException("offline") }, put = { puts++; body("{}") })
        v.save(false) // still loading
        v.load()
        v.save(false) // load failed
        assertEquals(0, puts)
    }

    @Test fun save_sameValueMakesNoCall() = runBlocking {
        var puts = 0
        val v = vm(get = { body("""{"enabled":true,"preference":null,"mode":"all"}""") }, put = { puts++; body("{}") })
        v.load()
        v.save(true)
        assertEquals(0, puts)
    }
}
