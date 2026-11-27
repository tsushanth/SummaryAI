package com.kreativekoala.summaryai.ui.phone

import android.app.Activity
import com.google.gson.Gson
import com.kreativekoala.summaryai.data.api.models.ActiveTrialDto
import com.kreativekoala.summaryai.data.api.models.AgentDetailResponse
import com.kreativekoala.summaryai.data.api.models.AgentLanguageDto
import com.kreativekoala.summaryai.data.api.models.GetNumberRequest
import com.kreativekoala.summaryai.data.api.models.OwnAgentDto
import com.kreativekoala.summaryai.data.api.models.OwnNumberDto
import com.kreativekoala.summaryai.data.api.models.PhoneCallDto
import com.kreativekoala.summaryai.data.api.models.PhoneEventRequest
import com.kreativekoala.summaryai.data.api.models.PhonePlanResponse
import com.kreativekoala.summaryai.data.api.models.PhonePurchaseRequest
import com.kreativekoala.summaryai.data.api.models.PhonePurchaseResponse
import com.kreativekoala.summaryai.data.api.models.PhoneSubscriptionDto
import com.kreativekoala.summaryai.data.api.models.PhoneTrialDto
import com.kreativekoala.summaryai.data.api.models.ReleaseNumberResponse
import com.kreativekoala.summaryai.data.api.models.SetAgentRequest
import com.kreativekoala.summaryai.data.api.models.SetAgentResponse
import com.kreativekoala.summaryai.data.repository.OwnNumberSource
import com.kreativekoala.summaryai.data.repository.toDomain
import com.kreativekoala.summaryai.service.PhonePurchases
import com.kreativekoala.summaryai.service.accountHash
import com.kreativekoala.summaryai.util.PhoneDevice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class OwnNumberTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private val number = OwnNumberDto("n1", "+14155550100", "US")
    private val offered = PhonePlanResponse(trial = PhoneTrialDto(offered = true, days = 14, agentMinutes = 15))
    private val onTrial = PhonePlanResponse(
        number = number, agentsAvailable = true,
        trial = PhoneTrialDto(active = ActiveTrialDto("2026-12-10T10:00:00+00:00", 15))
    )

    private class FakeSource(var current: PhonePlanResponse) : OwnNumberSource {
        val numberRequests = mutableListOf<GetNumberRequest>()
        val agentRequests = mutableListOf<SetAgentRequest>()
        val purchases = mutableListOf<PhonePurchaseRequest>()
        val steps = mutableListOf<String>()
        var released = 0
        var warnings: List<String> = emptyList()
        var agentFailure: Throwable? = null
        /** The agent appears although the request failed. */
        var agentAppearsAnyway = false

        override suspend fun plan() = Result.success(current)
        override suspend fun getNumber(request: GetNumberRequest): Result<OwnNumberDto> {
            numberRequests += request
            val bought = OwnNumberDto("n1", "+14155550100", request.country)
            current = current.copy(number = bought, agentsAvailable = true)
            return Result.success(bought)
        }
        override suspend fun releaseNumber(): Result<ReleaseNumberResponse> {
            released++
            current = PhonePlanResponse(trial = PhoneTrialDto(used = true))
            return Result.success(ReleaseNumberResponse(true))
        }
        override suspend fun agentLanguages() = Result.success(listOf(AgentLanguageDto("en"), AgentLanguageDto("es")))
        override suspend fun agentDetail() = Result.success(AgentDetailResponse("Take a message.", "en"))
        override suspend fun setAgent(request: SetAgentRequest): Result<SetAgentResponse> {
            agentRequests += request
            val failure = agentFailure
            if (failure == null || agentAppearsAnyway) current = current.copy(agent = OwnAgentDto("Takes a message.", request.language))
            return failure?.let { Result.failure(it) } ?: Result.success(SetAgentResponse("Takes a message.", request.language, warnings))
        }
        override suspend fun deleteAgent(): Result<Unit> {
            current = current.copy(agent = null)
            return Result.success(Unit)
        }
        override suspend fun confirmPurchase(request: PhonePurchaseRequest): Result<PhonePurchaseResponse> {
            purchases += request
            return Result.success(PhonePurchaseResponse())
        }
        override suspend fun event(request: PhoneEventRequest) { steps += request.step }
    }

    private class FakePurchases(var price: String? = null) : PhonePurchases {
        override val completed = MutableSharedFlow<Pair<String, String>>(extraBufferCapacity = 1)
        var asked = 0
        override suspend fun price(productId: String) = price.also { asked++ }
        override suspend fun buy(activity: Activity, productId: String) = true
        override suspend fun ownedToken(productId: String): String? = null
    }

    private val device = object : PhoneDevice {
        override val region = "CA"
        override val language = "es-US"
        override val isTest = true
    }

    private fun TestScope.model(source: FakeSource, purchases: FakePurchases = FakePurchases()): OwnNumberViewModel {
        val model = OwnNumberViewModel(source, purchases, device)
        model.opened()
        advanceUntilIdle()
        return model
    }

    @Test fun theServerDecidesWhatIsOffered() {
        assertFalse(numberOffers(PhonePlanResponse()).any)
        assertFalse(numberOffers(PhonePlanResponse(trial = PhoneTrialDto(used = true))).any)
        assertEquals(NumberOffers(trial = true, purchase = false, paidNumber = false), numberOffers(offered))
        // Purchase stays hidden while the server has it off, and for a product that is not an own-number one.
        assertFalse(numberOffers(PhonePlanResponse(productId = "mm_phone_number")).purchase)
        assertFalse(numberOffers(PhonePlanResponse(purchaseEnabled = true, productId = "yearly")).purchase)
        assertTrue(numberOffers(PhonePlanResponse(purchaseEnabled = true, productId = "mm_phone_number")).purchase)
        val subscribed = PhonePlanResponse(purchaseEnabled = true, productId = "mm_phone_number", subscription = PhoneSubscriptionDto())
        assertEquals(NumberOffers(trial = false, purchase = false, paidNumber = true), numberOffers(subscribed))
    }

    @Test fun aNumberNothingPaysForIsNotOfferedForCalls() {
        assertEquals(number, usableNumber(onTrial))
        assertEquals(number, usableNumber(PhonePlanResponse(number = number, subscription = PhoneSubscriptionDto())))
        assertNull(usableNumber(PhonePlanResponse(number = number, trial = PhoneTrialDto(used = true))))
        assertNull(usableNumber(PhonePlanResponse(number = number)))
        assertNull(usableNumber(null))
    }

    @Test fun theAgentLanguageStartsWithTheAppLanguage() {
        assertEquals("es", defaultAgentLanguage("es-US", listOf("en", "es")))
        assertEquals("en", defaultAgentLanguage("de-DE", listOf("es", "en")))
        assertEquals("pt-BR", defaultAgentLanguage("pt-BR", listOf("en", "pt-BR")))
        assertEquals("es", defaultAgentLanguage("de", listOf("es")))
        assertEquals("en", defaultAgentLanguage("de", emptyList()))
    }

    @Test fun aPurchaseIsTiedToTheAccountByTheHashTheServerCompares() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", accountHash("abc"))
    }

    @Test fun noNumberIsBoughtBeforeTheTrialIsConfirmed() = runTest(dispatcher) {
        val source = FakeSource(offered)
        val model = model(source)
        assertEquals("CA", model.uiState.value.country)
        model.requestNumber()
        advanceUntilIdle()
        assertTrue(model.uiState.value.confirmTrial)
        model.declineTrial()
        model.acceptTrial() // nothing is waiting to be accepted
        advanceUntilIdle()
        assertTrue(source.numberRequests.isEmpty())

        model.setAreaCode("4a1b5")
        model.requestNumber()
        model.acceptTrial()
        model.acceptTrial()
        advanceUntilIdle()
        assertEquals(listOf(GetNumberRequest("CA", "415", true)), source.numberRequests)
        assertEquals(
            listOf("own_number_opened", "own_number_confirm_shown", "own_number_confirm_declined", "own_number_confirm_shown"),
            source.steps
        )
    }

    @Test fun aSubscribersNumberNeedsNoTrialQuestion() = runTest(dispatcher) {
        val source = FakeSource(PhonePlanResponse(purchaseEnabled = true, productId = "mm_phone_number", subscription = PhoneSubscriptionDto()))
        val model = model(source)
        model.requestNumber()
        advanceUntilIdle()
        assertEquals(null, source.numberRequests.single().confirmTrial)
    }

    @Test fun anAgentIsMadeFromTheDescription() = runTest(dispatcher) {
        val source = FakeSource(onTrial).apply { warnings = listOf("ability_removed") }
        val model = model(source)
        assertTrue(model.uiState.value.showAgentForm)
        model.formShown()
        model.formShown()
        advanceUntilIdle()
        assertEquals("es", model.uiState.value.language)
        model.setPrompt("short")
        model.saveAgent()
        advanceUntilIdle()
        assertTrue(source.agentRequests.isEmpty())
        model.setPrompt("  Take a message and a number.  ")
        model.saveAgent()
        model.saveAgent()
        advanceUntilIdle()
        assertEquals(listOf(SetAgentRequest("Take a message and a number.", "es")), source.agentRequests)
        with(model.uiState.value) {
            assertFalse(showAgentForm)
            assertTrue(leftOut)
            assertEquals(1, agentsSaved)
        }
        assertEquals(1, source.steps.count { it == "agent_form_opened" })

        model.editAgent()
        advanceUntilIdle()
        assertTrue(model.uiState.value.showAgentForm)
        assertEquals("Take a message.", model.uiState.value.prompt)
        model.cancelEdit()
        model.askToDeleteAgent()
        model.deleteAgent()
        advanceUntilIdle()
        assertNull(model.uiState.value.plan?.agent)
        assertTrue(model.uiState.value.showAgentForm)
    }

    @Test fun anAgentThatAppearsAfterTheConnectionGaveUpCounts() = runTest(dispatcher) {
        val source = FakeSource(onTrial).apply { agentFailure = IOException("timeout"); agentAppearsAnyway = true }
        val model = model(source)
        model.setPrompt("Take a message and a number.")
        model.saveAgent()
        advanceUntilIdle()
        assertEquals(1, model.uiState.value.agentsSaved)
        assertNull(model.uiState.value.message)
    }

    @Test fun aFailedAgentSetupSaysSo() = runTest(dispatcher) {
        val source = FakeSource(onTrial).apply { agentFailure = IOException("offline") }
        val model = model(source)
        model.setPrompt("Take a message and a number.")
        model.saveAgent()
        advanceUntilIdle()
        assertEquals(0, model.uiState.value.agentsSaved)
        assertTrue(model.uiState.value.message is PhoneMessage.Failure)
        assertEquals("Take a message and a number.", model.uiState.value.prompt)
        assertFalse(model.uiState.value.saving)
    }

    @Test fun endingTheTrialReleasesTheNumber() = runTest(dispatcher) {
        val source = FakeSource(onTrial)
        val model = model(source)
        model.askToEndTrial()
        advanceUntilIdle()
        assertEquals(0, source.released)
        model.endTrial()
        advanceUntilIdle()
        assertEquals(1, source.released)
        assertNull(model.uiState.value.plan?.number)
        assertTrue(model.uiState.value.plan?.trial?.used == true)
    }

    @Test fun googlePlayIsAskedOnlyWhenTheServerOffersAPurchase() = runTest(dispatcher) {
        val purchases = FakePurchases(price = "$1.00")
        val source = FakeSource(offered)
        val model = model(source, purchases)
        assertEquals(0, purchases.asked)
        assertNull(model.uiState.value.price)

        source.current = PhonePlanResponse(purchaseEnabled = true, productId = "mm_phone_number")
        model.refresh()
        advanceUntilIdle()
        assertEquals("$1.00", model.uiState.value.price)
        purchases.completed.emit("mm_phone_number" to "token")
        advanceUntilIdle()
        assertEquals(listOf(PhonePurchaseRequest("token", "mm_phone_number")), source.purchases)
    }

    @Test fun theServersAnswersAreRead() {
        val plan = Gson().fromJson(
            """{"purchase_enabled":false,"product_id":null,"trial":{"offered":false,"days":14,"agent_minutes":15,
            "active":{"ends_at":"2026-12-10T10:00:00+00:00","agent_minutes_left":12},"used":false},
            "number":{"id":"n1","phone_number":"+14155550100","country":"US"},"agents_available":true,
            "agent":{"description":"Takes a message.","language":"en"},"subscription":null}""",
            PhonePlanResponse::class.java
        )
        assertEquals(12, plan.trial?.active?.agentMinutesLeft)
        assertEquals("+14155550100", plan.number?.phoneNumber)
        val call = Gson().fromJson(
            """{"id":"c","from_number":"+14155550100","to_number":"+14155550123","to_name":"+14155550123","status":"completed",
            "created_at":"2026-12-01T10:00:00Z","direction":"in","agent":{"summary":"Ana called.","duration_seconds":75,
            "transcript":[{"role":"agent","text":"Hello"},{"role":"caller","text":"It is Ana"},{"role":"caller","text":""}],
            "collected":{"caller_name":"Ana"}}}""",
            PhoneCallDto::class.java
        ).toDomain()
        assertTrue(call.incoming)
        assertNull("the caller's number is not a name", call.toName)
        assertEquals("1:15", call.formattedDuration)
        assertEquals(listOf("caller name" to "Ana"), call.agent?.collected)
        assertEquals(listOf(true, false), call.agent?.transcript?.map { it.fromAgent })
        val plain = Gson().fromJson("""{"id":"d","from_number":"a","to_number":"b","created_at":"x"}""", PhoneCallDto::class.java).toDomain()
        assertNull(plain.agent)
        assertFalse(plain.incoming)
    }
}
