package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.*
import com.kreativekoala.summaryai.domain.model.AgentReport
import com.kreativekoala.summaryai.domain.model.AgentTurn
import com.kreativekoala.summaryai.domain.model.PhoneCall
import com.kreativekoala.summaryai.domain.model.PhoneCallStatus
import com.kreativekoala.summaryai.domain.model.VerifiedPhone
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

/** What the own-number screen needs from the server. */
interface OwnNumberSource {
    suspend fun plan(): Result<PhonePlanResponse>
    suspend fun getNumber(request: GetNumberRequest): Result<OwnNumberDto>
    suspend fun releaseNumber(): Result<ReleaseNumberResponse>
    suspend fun agentLanguages(): Result<List<AgentLanguageDto>>
    suspend fun agentDetail(): Result<AgentDetailResponse>
    suspend fun setAgent(request: SetAgentRequest): Result<SetAgentResponse>
    suspend fun deleteAgent(): Result<Unit>
    suspend fun confirmPurchase(request: PhonePurchaseRequest): Result<PhonePurchaseResponse>
    /** Measuring never fails or delays anything. */
    suspend fun event(request: PhoneEventRequest)
}

/** Phone calls. The server decides everything; this only carries requests and answers. */
@Singleton
class PhoneRepository @Inject constructor(
    private val api: SummaryAIApi
) : OwnNumberSource {
    private suspend fun <T> call(block: suspend () -> T): Result<T> = withContext(Dispatchers.IO) {
        try {
            Result.success(block())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun status(): Result<PhoneStatusResponse> = call { api.getPhoneStatus() }

    suspend fun startVerification(phoneNumber: String): Result<StartVerificationResponse> =
        call { api.startPhoneVerification(StartVerificationRequest(phoneNumber)) }

    suspend fun verification(id: String): Result<VerificationStatusResponse> = call { api.getPhoneVerification(id) }

    suspend fun deleteVerifiedPhone(id: String): Result<Unit> = call {
        val response = api.deleteVerifiedPhone(id)
        if (!response.isSuccessful) throw HttpException(response)
    }

    suspend fun startCall(request: StartCallRequest): Result<StartCallResponse> = call { api.startPhoneCall(request) }

    suspend fun calls(limit: Int = 50, offset: Int = 0): Result<List<PhoneCall>> =
        call { api.getPhoneCalls(limit, offset).calls.map { it.toDomain() } }

    suspend fun phoneCall(callId: String): Result<PhoneCall> = call { api.getPhoneCall(callId).call.toDomain() }

    suspend fun hangup(callId: String): Result<Boolean> = call { api.hangupCall(callId).ended }

    override suspend fun event(request: PhoneEventRequest) { call { api.postPhoneEvent(request) } }

    override suspend fun plan(): Result<PhonePlanResponse> = call { api.getPhonePlan() }

    override suspend fun getNumber(request: GetNumberRequest): Result<OwnNumberDto> = call { api.getOwnNumber(request) }

    override suspend fun releaseNumber(): Result<ReleaseNumberResponse> = call { api.releaseOwnNumber() }

    override suspend fun agentLanguages(): Result<List<AgentLanguageDto>> = call { api.getAgentLanguages().languages.orEmpty() }

    override suspend fun agentDetail(): Result<AgentDetailResponse> = call { api.getPhoneAgent() }

    override suspend fun setAgent(request: SetAgentRequest): Result<SetAgentResponse> = call { api.setPhoneAgent(request) }

    override suspend fun deleteAgent(): Result<Unit> = call {
        val response = api.deletePhoneAgent()
        if (!response.isSuccessful) throw HttpException(response)
    }

    override suspend fun confirmPurchase(request: PhonePurchaseRequest): Result<PhonePurchaseResponse> =
        call { api.confirmPhonePurchase(request) }.onFailure { e ->
            // The person paid and does not have it yet: always worth a report. Status only, never the token.
            com.kreativekoala.summaryai.FailureReporter.failure(
                flow = "phone_purchase_confirm",
                message = "phone purchase could not be confirmed", // i18n-ok
                context = mapOf("code" to ((e as? HttpException)?.code()?.toString() ?: "network"))
            )
        }

    suspend fun profile(request: PhoneProfileRequest): Result<Unit> = call {
        val response = api.postPhoneProfile(request)
        if (!response.isSuccessful) throw HttpException(response)
    }
}

fun VerifiedPhoneDto.toDomain() = VerifiedPhone(id = id, phoneNumber = phoneNumber)

internal fun PhoneCallDto.toDomain() = PhoneCall(
    id = id,
    fromNumber = fromNumber,
    toNumber = toNumber,
    // An incoming call is stored under the caller's number, which is not a name.
    toName = toName?.takeIf { it != toNumber },
    status = PhoneCallStatus.fromWire(status),
    recordingDuration = recordingDuration,
    recordingId = recordingId,
    startedAt = startedAt,
    createdAt = createdAt,
    incoming = direction == "in",
    agent = agent?.toDomain()
)

private fun AgentReportDto.toDomain() = AgentReport(
    summary = summary?.takeIf { it.isNotBlank() },
    durationSeconds = durationSeconds,
    transcript = transcript.orEmpty().mapNotNull { turn ->
        turn.text?.takeIf { it.isNotBlank() }?.let { AgentTurn(fromAgent = turn.role == "agent", text = it) }
    },
    collected = collected.orEmpty().map { (name, value) -> name.replace('_', ' ') to value }
)
