package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.*
import com.kreativekoala.summaryai.domain.model.PhoneCall
import com.kreativekoala.summaryai.domain.model.PhoneCallStatus
import com.kreativekoala.summaryai.domain.model.VerifiedPhone
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

/** Phone calls. The server decides everything; this only carries requests and answers. */
@Singleton
class PhoneRepository @Inject constructor(
    private val api: SummaryAIApi
) {
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

    /** Measuring never fails or delays anything. */
    suspend fun event(request: PhoneEventRequest) { call { api.postPhoneEvent(request) } }

    suspend fun profile(request: PhoneProfileRequest): Result<Unit> = call {
        val response = api.postPhoneProfile(request)
        if (!response.isSuccessful) throw HttpException(response)
    }
}

fun VerifiedPhoneDto.toDomain() = VerifiedPhone(id = id, phoneNumber = phoneNumber)

private fun PhoneCallDto.toDomain() = PhoneCall(
    id = id,
    fromNumber = fromNumber,
    toNumber = toNumber,
    toName = toName,
    status = PhoneCallStatus.fromWire(status),
    recordingDuration = recordingDuration,
    recordingId = recordingId,
    startedAt = startedAt,
    createdAt = createdAt
)
