package com.kreativekoala.summaryai.ui.phone

import android.content.ContextWrapper
import com.google.gson.Gson
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.PhoneEventRequest
import com.kreativekoala.summaryai.data.api.models.PhoneProfileRequest
import com.kreativekoala.summaryai.data.api.models.PhoneStatusResponse
import com.kreativekoala.summaryai.data.api.models.StartCallRequest
import com.kreativekoala.summaryai.data.api.models.StartCallResponse
import com.kreativekoala.summaryai.data.api.models.StartVerificationResponse
import com.kreativekoala.summaryai.data.api.models.VerificationStatusResponse
import com.kreativekoala.summaryai.data.api.models.VerifiedPhoneDto
import com.kreativekoala.summaryai.data.repository.PhoneRepository
import com.kreativekoala.summaryai.data.repository.PhoneSource
import com.kreativekoala.summaryai.domain.model.PhoneCall
import com.kreativekoala.summaryai.service.MoreMinutesMemory
import com.kreativekoala.summaryai.service.VoipService
import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import com.kreativekoala.summaryai.util.CountrySignals
import com.kreativekoala.summaryai.util.PhoneDevice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException

/** The question about more minutes: when it is asked, what it records and how long the answer is remembered. */
@OptIn(ExperimentalCoroutinesApi::class)
class MoreMinutesTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private val prefs = FakeSharedPreferences()
    private var account = "a"
    private var month = "2026-11"
    private val memory = MoreMinutesMemory(prefs, { account }, { month })

    private fun status(minutes: Int, purchaseOffered: Boolean? = false, available: Boolean = true) = PhoneStatusResponse(
        enabled = true, consentVersion = "v1", minutesLeft = minutes, minutesPerMonth = 30, serviceAvailable = available,
        businessAnswered = true, phones = listOf(VerifiedPhoneDto("p1", "+14155550100", null, null)), purchaseOffered = purchaseOffered
    )

    private class FakeSource(var current: Result<PhoneStatusResponse>) : PhoneSource {
        val steps = mutableListOf<PhoneEventRequest>()
        val started = mutableListOf<StartCallRequest>()
        var interestFailure: Throwable? = null
        var callFailure: Throwable = IOException("offline")
        val names get() = steps.map { it.step }.filter { it.startsWith("more_minutes") }

        override suspend fun status() = current
        override suspend fun startVerification(phoneNumber: String): Result<StartVerificationResponse> = error("not used")
        override suspend fun verification(id: String): Result<VerificationStatusResponse> = error("not used")
        override suspend fun deleteVerifiedPhone(id: String): Result<Unit> = error("not used")
        override suspend fun startCall(request: StartCallRequest): Result<StartCallResponse> {
            started += request
            return Result.failure(callFailure)
        }
        override suspend fun calls(limit: Int, offset: Int) = Result.success(emptyList<PhoneCall>())
        override suspend fun phoneCall(callId: String): Result<PhoneCall> = error("not used")
        override suspend fun profile(request: PhoneProfileRequest) = Result.success(Unit)
        override suspend fun event(request: PhoneEventRequest) { steps += request }
        override suspend fun confirmedEvent(request: PhoneEventRequest): Result<Unit> {
            interestFailure?.let { return Result.failure(it) }
            steps += request
            return Result.success(Unit)
        }
    }

    private val device = object : PhoneDevice {
        override val region = "US"
        override val countries = CountrySignals(region = "US")
        override val language = "en-US"
        override val isTest = false
    }

    /** The calling service is built but never asked to call: no test gets as far as a started call. */
    private fun voip(): VoipService {
        val api = Retrofit.Builder().baseUrl("http://localhost/").addConverterFactory(GsonConverterFactory.create(Gson())).build()
            .create(SummaryAIApi::class.java)
        return VoipService(ContextWrapper(null), PhoneRepository(api))
    }

    private fun TestScope.model(source: FakeSource): PhoneViewModel {
        val model = PhoneViewModel(source, voip(), { "en" }, device, memory)
        advanceUntilIdle()
        return model
    }

    private fun TestScope.tryToCall(model: PhoneViewModel) {
        model.requestCall("+14155550177", null)
        advanceUntilIdle()
    }

    private fun refused(code: String) = HttpException(
        Response.error<Any>(429, """{"error":{"code":"$code","message":"x"}}""".toResponseBody("application/json".toMediaType()))
    )

    @Test fun theCardAppearsAtFiveMinutesOrFewerWhenNothingCanBeBought() = runTest(dispatcher) {
        for ((minutes, shown) in listOf(30 to false, 6 to false, 5 to true, 1 to true, 0 to true)) {
            val source = FakeSource(Result.success(status(minutes)))
            val model = model(source)
            assertEquals("$minutes minutes", shown, model.uiState.value.showMoreMinutes)
            assertEquals("$minutes minutes", if (shown) listOf("more_minutes_shown") else emptyList<String>(), source.names)
        }
    }

    @Test fun nothingIsAskedWhenAPurchaseIsOfferedOrTheServerDoesNotSayOrCallsAreUsedUp() = runTest(dispatcher) {
        for (answer in listOf(status(0, purchaseOffered = true), status(0, purchaseOffered = null), status(0, available = false))) {
            val source = FakeSource(Result.success(answer))
            val model = model(source)
            assertFalse(model.uiState.value.showMoreMinutes)
            tryToCall(model)
            assertFalse(model.uiState.value.noMinutesDialog)
            assertTrue("the message as before", model.uiState.value.message is PhoneMessage.Resource)
            assertEquals(emptyList<String>(), source.names)
        }
    }

    @Test fun nothingIsAskedWhenTheStatusCouldNotBeRead() = runTest(dispatcher) {
        val source = FakeSource(Result.failure(IOException("offline")))
        assertFalse(model(source).uiState.value.showMoreMinutes)
        assertEquals(emptyList<String>(), source.names)
    }

    @Test fun theCardIsCountedOnceAVisit() = runTest(dispatcher) {
        val source = FakeSource(Result.success(status(3)))
        val model = model(source)
        model.refresh()
        model.selectTab(PhoneTab.CALLS)
        model.selectTab(PhoneTab.DIALER)
        advanceUntilIdle()
        assertEquals(listOf("more_minutes_shown"), source.names)
    }

    @Test fun theCardIsNotCountedWhileAnotherTabIsOpen() = runTest(dispatcher) {
        val source = FakeSource(Result.success(status(20)))
        val model = model(source)
        source.current = Result.success(status(2))
        model.selectTab(PhoneTab.CALLS) // reads the status again
        advanceUntilIdle()
        assertEquals(emptyList<String>(), source.names)
        model.selectTab(PhoneTab.DIALER)
        advanceUntilIdle()
        assertEquals(listOf("more_minutes_shown"), source.names)
    }

    @Test fun aCallWithNoMinutesAsksInsteadOfFailing() = runTest(dispatcher) {
        val source = FakeSource(Result.success(status(0)))
        val model = model(source)
        tryToCall(model)
        assertTrue(model.uiState.value.noMinutesDialog)
        assertNull(model.uiState.value.message)
        assertNull(model.uiState.value.consent)
        tryToCall(model) // already asking
        assertEquals(listOf("more_minutes_shown", "more_minutes_shown"), source.names) // the card, then the call
        model.closeNoMinutes()
        assertFalse(model.uiState.value.noMinutesDialog)
        assertTrue(source.started.isEmpty())
    }

    @Test fun aCallWithMinutesLeftGoesAheadAsBefore() = runTest(dispatcher) {
        val model = model(FakeSource(Result.success(status(2))))
        tryToCall(model)
        assertFalse(model.uiState.value.noMinutesDialog)
        assertTrue(model.uiState.value.consent != null)
    }

    @Test fun theServerFindingNoMinutesAsksToo() = runTest(dispatcher) {
        val source = FakeSource(Result.success(status(4))).apply { callFailure = refused("PHONE_MINUTES_USED") }
        val model = model(source)
        tryToCall(model)
        model.acceptConsent()
        advanceUntilIdle()
        assertTrue(model.uiState.value.noMinutesDialog)
        assertNull(model.uiState.value.message)
        assertFalse(model.uiState.value.starting)
    }

    @Test fun otherRefusalsAndAServerWithSomethingToBuyStillShowTheReason() = runTest(dispatcher) {
        for ((offered, code) in listOf(false to "PHONE_CALL_LIMIT", true to "PHONE_MINUTES_USED")) {
            val source = FakeSource(Result.success(status(4, purchaseOffered = offered))).apply { callFailure = refused(code) }
            val model = model(source)
            tryToCall(model)
            model.acceptConsent()
            advanceUntilIdle()
            assertFalse(model.uiState.value.noMinutesDialog)
            assertTrue(model.uiState.value.message is PhoneMessage.Failure)
        }
    }

    @Test fun theAnswerIsRecordedOnceThankedAndRememberedForTheMonth() = runTest(dispatcher) {
        val source = FakeSource(Result.success(status(0)))
        val model = model(source)
        model.askForMoreMinutes()
        model.askForMoreMinutes() // a second tap while sending
        advanceUntilIdle()
        model.askForMoreMinutes()
        advanceUntilIdle()
        assertTrue(model.uiState.value.moreMinutesAsked)
        assertFalse(model.uiState.value.sendingMoreMinutes)
        assertEquals(listOf("more_minutes_shown", "more_minutes_interest"), source.names)

        // The next visit shows the thanks, counts nothing and a call shows the thanks too.
        val again = FakeSource(Result.success(status(0)))
        val later = model(again)
        assertTrue(later.uiState.value.showMoreMinutes)
        assertTrue(later.uiState.value.moreMinutesAsked)
        tryToCall(later)
        assertTrue(later.uiState.value.noMinutesDialog)
        assertTrue(later.uiState.value.moreMinutesAsked)
        later.askForMoreMinutes()
        advanceUntilIdle()
        assertEquals(emptyList<String>(), again.names)
    }

    @Test fun theNextMonthAndAnotherAccountAreAskedAgain() = runTest(dispatcher) {
        memory.remember()
        assertTrue(memory.askedThisMonth())
        month = "2026-12"
        assertFalse(memory.askedThisMonth())
        val source = FakeSource(Result.success(status(1)))
        assertFalse(model(source).uiState.value.moreMinutesAsked)
        assertEquals(listOf("more_minutes_shown"), source.names)
        month = "2026-11"
        account = "b"
        assertFalse(memory.askedThisMonth())
        account = "a"
        assertTrue("kept on the device", MoreMinutesMemory(prefs, { account }, { month }).askedThisMonth())
    }

    @Test fun anAnswerThatDidNotArriveIsNeitherThankedNorRemembered() = runTest(dispatcher) {
        val source = FakeSource(Result.success(status(0))).apply { interestFailure = IOException("offline") }
        val model = model(source)
        tryToCall(model)
        model.askForMoreMinutes()
        advanceUntilIdle()
        assertFalse(model.uiState.value.moreMinutesAsked)
        assertFalse(model.uiState.value.sendingMoreMinutes)
        assertFalse(model.uiState.value.noMinutesDialog)
        assertTrue(model.uiState.value.message is PhoneMessage.Failure)
        assertFalse(memory.askedThisMonth())
        source.interestFailure = null
        model.askForMoreMinutes()
        advanceUntilIdle()
        assertTrue(model.uiState.value.moreMinutesAsked)
        assertTrue(memory.askedThisMonth())
    }

    @Test fun theStepsCarryNoPhoneNumber() = runTest(dispatcher) {
        val source = FakeSource(Result.success(status(0)))
        val model = model(source)
        model.setDialerNumber("+14155550177")
        tryToCall(model)
        model.askForMoreMinutes()
        advanceUntilIdle()
        for (step in source.steps) assertFalse(Gson().toJson(step), Gson().toJson(step).contains("415555"))
        assertEquals(PhoneEventRequest("more_minutes_interest", "US", null), source.steps.last())
    }

    @Test fun theStatusSaysWhetherAPurchaseIsOffered() {
        assertEquals(false, Gson().fromJson("""{"enabled":true,"purchase_offered":false}""", PhoneStatusResponse::class.java).purchaseOffered)
        assertNull(Gson().fromJson("""{"enabled":true}""", PhoneStatusResponse::class.java).purchaseOffered)
    }
}
