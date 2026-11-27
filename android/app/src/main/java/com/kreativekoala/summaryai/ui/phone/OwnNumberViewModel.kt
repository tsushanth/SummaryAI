package com.kreativekoala.summaryai.ui.phone

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.api.models.GetNumberRequest
import com.kreativekoala.summaryai.data.api.models.OwnAgentDto
import com.kreativekoala.summaryai.data.api.models.OwnNumberDto
import com.kreativekoala.summaryai.data.api.models.PhoneEventRequest
import com.kreativekoala.summaryai.data.api.models.PhonePlanResponse
import com.kreativekoala.summaryai.data.api.models.PhonePurchaseRequest
import com.kreativekoala.summaryai.data.api.models.SetAgentRequest
import com.kreativekoala.summaryai.data.repository.OwnNumberSource
import com.kreativekoala.summaryai.service.BillingManager
import com.kreativekoala.summaryai.service.PhonePurchases
import com.kreativekoala.summaryai.util.ApiErrors
import com.kreativekoala.summaryai.util.PhoneDevice
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException
import javax.inject.Inject

/** What can be offered to an account that has no number yet. All false: there is nothing to get. */
data class NumberOffers(
    /** The free trial. */
    val trial: Boolean,
    /** A subscription to buy. */
    val purchase: Boolean,
    /** A number the account's subscription already pays for. */
    val paidNumber: Boolean
) {
    val any: Boolean get() = trial || purchase || paidNumber
}

fun numberOffers(plan: PhonePlanResponse): NumberOffers {
    val subscribed = plan.subscription != null
    return NumberOffers(
        trial = !subscribed && (plan.trial?.offered == true || plan.trial?.active != null),
        purchase = !subscribed && plan.purchaseEnabled &&
            plan.productId?.startsWith(BillingManager.PHONE_PRODUCT_PREFIX) == true,
        paidNumber = subscribed && plan.purchaseEnabled
    )
}

/** The number only while a subscription or the trial pays for it; after that it is on its way out. */
fun usableNumber(plan: PhonePlanResponse?): OwnNumberDto? =
    plan?.number?.takeIf { plan.subscription != null || plan.trial?.active != null }

const val AGENT_PROMPT_MIN = 10
const val AGENT_PROMPT_MAX = 2000

/** The agent's language offered first: the app's own when the agent speaks it. */
fun defaultAgentLanguage(appLanguage: String, offered: List<String>): String {
    val own = appLanguage.lowercase().substringBefore('-')
    return offered.firstOrNull { it.equals(appLanguage, ignoreCase = true) }
        ?: offered.firstOrNull { it == own }
        ?: offered.firstOrNull { it == "en" }
        ?: offered.firstOrNull()
        ?: "en"
}

data class OwnNumberUiState(
    val loading: Boolean = true,
    val plan: PhonePlanResponse? = null,
    val message: PhoneMessage? = null,
    val country: String = "US",
    val areaCode: String = "",
    val confirmTrial: Boolean = false,
    val gettingNumber: Boolean = false,
    val confirmEnd: Boolean = false,
    val ending: Boolean = false,
    /** An existing agent is being changed. Without an agent the form is shown anyway. */
    val editing: Boolean = false,
    val prompt: String = "",
    val language: String = "en",
    val languages: List<String> = emptyList(),
    val saving: Boolean = false,
    val confirmDelete: Boolean = false,
    /** The last description asked for something the agent does not do. */
    val leftOut: Boolean = false,
    /** Google Play's price; purchase stays hidden without it. */
    val price: String? = null,
    /** Counts agents set up in this visit. */
    val agentsSaved: Int = 0
) {
    val showAgentForm: Boolean get() = plan?.agentsAvailable == true && plan.number != null && (plan.agent == null || editing)
}

@HiltViewModel
class OwnNumberViewModel @Inject constructor(
    private val source: OwnNumberSource,
    private val purchases: PhonePurchases,
    private val device: PhoneDevice
) : ViewModel() {

    private val _uiState = MutableStateFlow(OwnNumberUiState())
    val uiState: StateFlow<OwnNumberUiState> = _uiState.asStateFlow()

    private var formShown = false
    private var restoreTried = false

    init {
        viewModelScope.launch { purchases.completed.collect { (productId, token) -> confirmPurchase(productId, token) } }
    }

    private fun track(step: String) {
        viewModelScope.launch { source.event(PhoneEventRequest(step, device.region, device.isTest.takeIf { it })) }
    }

    /** The person opened the screen. */
    fun opened() {
        track("own_number_opened")
        refresh()
    }

    fun refresh() {
        viewModelScope.launch { load() }
    }

    private suspend fun load(): PhonePlanResponse? {
        val plan = source.plan().getOrElse { e ->
            _uiState.update { it.copy(loading = false, message = PhoneMessage.Failure(e)) }
            return null
        }
        _uiState.update {
            it.copy(
                loading = false,
                plan = plan,
                editing = it.editing && plan.agent != null,
                country = if (it.plan == null && device.region == "CA") "CA" else it.country
            )
        }
        val productId = plan.productId
        if (numberOffers(plan).purchase && productId != null) {
            val price = purchases.price(productId)
            _uiState.update { it.copy(price = price) }
            if (!restoreTried) {
                restoreTried = true
                purchases.ownedToken(productId)?.let { confirmPurchase(productId, it) }
            }
        } else {
            _uiState.update { it.copy(price = null) }
        }
        return plan
    }

    fun clearMessage() = _uiState.update { it.copy(message = null) }

    // MARK: - The number

    fun setCountry(code: String) = _uiState.update { it.copy(country = code) }
    fun setAreaCode(value: String) = _uiState.update { it.copy(areaCode = value.filter(Char::isDigit).take(3)) }

    /** A trial starts only after the person has read what it is; a paid number is bought at once. */
    fun requestNumber() {
        val plan = _uiState.value.plan ?: return
        if (numberOffers(plan).trial) {
            track("own_number_confirm_shown")
            _uiState.update { it.copy(confirmTrial = true) }
        } else {
            getNumber(confirmTrial = null)
        }
    }

    fun declineTrial() {
        track("own_number_confirm_declined")
        _uiState.update { it.copy(confirmTrial = false) }
    }

    fun acceptTrial() {
        if (!_uiState.value.confirmTrial) return
        _uiState.update { it.copy(confirmTrial = false) }
        getNumber(confirmTrial = true)
    }

    private fun getNumber(confirmTrial: Boolean?) {
        val state = _uiState.value
        if (state.gettingNumber) return
        _uiState.update { it.copy(gettingNumber = true) }
        viewModelScope.launch {
            val request = GetNumberRequest(state.country, state.areaCode.takeIf { it.length == 3 }, confirmTrial)
            val failure = source.getNumber(request).exceptionOrNull()
            load()
            _uiState.update { it.copy(gettingNumber = false, message = failure?.let(PhoneMessage::Failure) ?: it.message) }
        }
    }

    fun askToEndTrial() = _uiState.update { it.copy(confirmEnd = true) }
    fun keepTrial() = _uiState.update { it.copy(confirmEnd = false) }

    fun endTrial() {
        if (_uiState.value.ending) return
        _uiState.update { it.copy(confirmEnd = false, ending = true) }
        viewModelScope.launch {
            val answer = source.releaseNumber()
            load()
            val message = answer.fold(
                onSuccess = { if (it.released) null else PhoneMessage.Resource(R.string.phone_number_removing) },
                onFailure = { PhoneMessage.Failure(it) }
            )
            _uiState.update { it.copy(ending = false, editing = false, prompt = "", message = message ?: it.message) }
        }
    }

    // MARK: - The agent

    /** The form came into view: counted once, and the languages are fetched. */
    fun formShown() {
        if (!formShown) {
            formShown = true
            track("agent_form_opened")
        }
        if (_uiState.value.languages.isNotEmpty()) return
        viewModelScope.launch {
            source.agentLanguages().fold(
                onSuccess = { list ->
                    val codes = list.map { it.code }
                    _uiState.update {
                        val chosen = it.language.takeIf { l -> it.editing && l in codes }
                        it.copy(languages = codes, language = chosen ?: it.plan?.agent?.language?.takeIf { l -> l in codes }
                            ?: defaultAgentLanguage(device.language, codes))
                    }
                },
                onFailure = { e -> _uiState.update { it.copy(message = PhoneMessage.Failure(e)) } }
            )
        }
    }

    fun setPrompt(value: String) = _uiState.update { it.copy(prompt = value.take(AGENT_PROMPT_MAX)) }
    fun setLanguage(code: String) = _uiState.update { it.copy(language = code) }

    fun editAgent() {
        val agent = _uiState.value.plan?.agent ?: return
        _uiState.update { it.copy(editing = true, leftOut = false, language = agent.language ?: it.language) }
        viewModelScope.launch {
            source.agentDetail().onSuccess { detail ->
                // Never over what the person has typed meanwhile.
                _uiState.update { if (it.prompt.isBlank()) it.copy(prompt = detail.prompt.orEmpty()) else it }
            }
        }
    }

    fun cancelEdit() = _uiState.update { it.copy(editing = false, prompt = "") }

    fun saveAgent() {
        val state = _uiState.value
        val prompt = state.prompt.trim()
        if (state.saving || prompt.length < AGENT_PROMPT_MIN) return
        val before = state.plan?.agent
        _uiState.update { it.copy(saving = true, leftOut = false) }
        viewModelScope.launch {
            source.setAgent(SetAgentRequest(prompt, state.language)).fold(
                onSuccess = { saved(leftOut = it.warnings?.contains("ability_removed") == true) },
                onFailure = { e ->
                    if (mayStillBeWorking(e) && appears(before)) saved(leftOut = false)
                    else _uiState.update { it.copy(saving = false, message = PhoneMessage.Failure(e)) }
                }
            )
        }
    }

    private suspend fun saved(leftOut: Boolean) {
        _uiState.update { it.copy(saving = false, editing = false, prompt = "", leftOut = leftOut, agentsSaved = it.agentsSaved + 1) }
        load()
    }

    /** The connection gave up, not the server: setting up may still be going on. */
    private fun mayStillBeWorking(e: Throwable): Boolean {
        if (e is IOException) return true
        val answer = ApiErrors.parse(e)
        return answer.code == null && answer.status in 502..504
    }

    private suspend fun appears(before: OwnAgentDto?): Boolean {
        repeat(AGENT_CHECKS) {
            delay(AGENT_CHECK_MS)
            val now = source.plan().getOrNull()?.agent
            if (now != null && now != before) return true
        }
        return false
    }

    fun askToDeleteAgent() = _uiState.update { it.copy(confirmDelete = true) }
    fun keepAgent() = _uiState.update { it.copy(confirmDelete = false) }

    fun deleteAgent() {
        _uiState.update { it.copy(confirmDelete = false) }
        viewModelScope.launch {
            source.deleteAgent().fold(
                onSuccess = {
                    _uiState.update { it.copy(editing = false, prompt = "", leftOut = false) }
                    load()
                },
                onFailure = { e -> _uiState.update { it.copy(message = PhoneMessage.Failure(e)) } }
            )
        }
    }

    // MARK: - Purchase (shown only when the server offers it)

    fun buy(activity: Activity) {
        val productId = _uiState.value.plan?.takeIf { numberOffers(it).purchase }?.productId ?: return
        track("purchase_started")
        viewModelScope.launch {
            if (!purchases.buy(activity, productId)) {
                _uiState.update { it.copy(message = PhoneMessage.Resource(R.string.phone_error_unavailable)) }
            }
        }
    }

    private suspend fun confirmPurchase(productId: String, token: String) {
        source.confirmPurchase(PhonePurchaseRequest(token, productId)).fold(
            onSuccess = { load() },
            onFailure = { e -> _uiState.update { it.copy(message = PhoneMessage.Failure(e)) } }
        )
    }

    private companion object {
        const val AGENT_CHECKS = 6
        const val AGENT_CHECK_MS = 10_000L
    }
}
