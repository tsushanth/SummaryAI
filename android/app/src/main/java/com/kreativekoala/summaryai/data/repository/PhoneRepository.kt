package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.*
import com.kreativekoala.summaryai.domain.model.PhoneCall
import com.kreativekoala.summaryai.domain.model.PhoneCallStatus
import com.kreativekoala.summaryai.domain.model.VerifiedPhone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for phone-related operations
 */
@Singleton
class PhoneRepository @Inject constructor(
    private val api: SummaryAIApi
) {
    // MARK: - Phone Verification

    /**
     * Send verification code to a phone number
     */
    suspend fun sendVerificationCode(phoneNumber: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val response = api.sendVerificationCode(SendVerificationRequest(phoneNumber))
            Result.success(response.message)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Check verification code
     */
    suspend fun checkVerificationCode(
        phoneNumber: String,
        code: String
    ): Result<VerifiedPhone?> = withContext(Dispatchers.IO) {
        try {
            val response = api.checkVerificationCode(
                CheckVerificationRequest(phoneNumber, code)
            )
            if (response.verified && response.phone != null) {
                Result.success(response.phone.toDomain())
            } else {
                Result.failure(Exception("Invalid verification code"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get list of verified phone numbers
     */
    suspend fun getVerifiedPhones(): Result<List<VerifiedPhone>> = withContext(Dispatchers.IO) {
        try {
            val response = api.getVerifiedPhones()
            Result.success(response.phones.map { it.toDomain() })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Delete a verified phone number
     */
    suspend fun deleteVerifiedPhone(id: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            api.deleteVerifiedPhone(id)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // MARK: - VoIP

    /**
     * Get VoIP access token for Twilio Voice SDK
     */
    suspend fun getVoipToken(): Result<String> = withContext(Dispatchers.IO) {
        try {
            val response = api.getVoipToken()
            Result.success(response.token)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // MARK: - Phone Calls

    /**
     * Create a phone call record for VoIP calling
     * Returns call details needed for VoIP client
     */
    suspend fun createCall(
        fromNumber: String,
        toNumber: String,
        toName: String? = null
    ): Result<VoipCallDetails> = withContext(Dispatchers.IO) {
        try {
            val response = api.createCall(
                InitiateCallRequest(
                    from = fromNumber,
                    to = toNumber,
                    toName = toName
                )
            )
            Result.success(
                VoipCallDetails(
                    callId = response.callId,
                    conferenceName = response.conferenceName,
                    toNumber = response.toNumber
                )
            )
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Legacy: Initiate a phone call (callback-based)
     * @deprecated Use createCall for VoIP calling
     */
    @Deprecated("Use createCall for VoIP calling")
    suspend fun initiateCall(
        fromNumber: String,
        toNumber: String,
        toName: String? = null
    ): Result<String> = withContext(Dispatchers.IO) {
        try {
            val response = api.createCall(
                InitiateCallRequest(
                    from = fromNumber,
                    to = toNumber,
                    toName = toName
                )
            )
            Result.success(response.callId)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get list of phone calls
     */
    suspend fun getPhoneCalls(
        limit: Int = 50,
        offset: Int = 0
    ): Result<PhoneCallsResult> = withContext(Dispatchers.IO) {
        try {
            val response = api.getPhoneCalls(limit, offset)
            Result.success(
                PhoneCallsResult(
                    calls = response.calls.map { it.toDomain() },
                    total = response.total,
                    limit = response.limit,
                    offset = response.offset
                )
            )
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get phone call details
     */
    suspend fun getPhoneCall(id: String): Result<PhoneCall> = withContext(Dispatchers.IO) {
        try {
            val response = api.getPhoneCall(id)
            Result.success(response.call.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Start recording a call
     */
    suspend fun startRecording(callId: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = api.startCallRecording(callId)
            Result.success(response.recording)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Stop recording a call
     */
    suspend fun stopRecording(callId: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = api.stopCallRecording(callId)
            Result.success(!response.recording)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Hang up a call
     */
    suspend fun hangupCall(callId: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = api.hangupCall(callId)
            Result.success(response.ended)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Poll for call status updates
     */
    fun pollCallStatus(callId: String, intervalMs: Long = 2000): Flow<PhoneCall> = flow {
        while (true) {
            try {
                val response = api.getPhoneCall(callId)
                val call = response.call.toDomain()
                emit(call)

                // Stop polling when call ends
                if (!call.status.isActive) {
                    break
                }
            } catch (e: Exception) {
                // Continue polling on error
            }
            delay(intervalMs)
        }
    }.flowOn(Dispatchers.IO)
}

/**
 * Result wrapper for phone calls list
 */
data class PhoneCallsResult(
    val calls: List<PhoneCall>,
    val total: Int,
    val limit: Int,
    val offset: Int
) {
    val hasMore: Boolean
        get() = calls.size + offset < total
}

/**
 * VoIP call details for initiating a call via Twilio Voice SDK
 */
data class VoipCallDetails(
    val callId: String,
    val conferenceName: String,
    val toNumber: String
)

// Extension functions to convert DTOs to domain models

private fun VerifiedPhoneDto.toDomain() = VerifiedPhone(
    id = id,
    phoneNumber = phoneNumber,
    verifiedAt = verifiedAt,
    createdAt = createdAt
)

private fun PhoneCallDto.toDomain() = PhoneCall(
    id = id,
    userId = userId,
    fromNumber = fromNumber,
    toNumber = toNumber,
    toName = toName,
    twilioCallSid = twilioCallSid,
    conferenceSid = conferenceSid,
    conferenceName = conferenceName,
    recordingSid = recordingSid,
    status = when (status) {
        com.kreativekoala.summaryai.data.api.models.PhoneCallStatus.INITIATED -> PhoneCallStatus.INITIATED
        com.kreativekoala.summaryai.data.api.models.PhoneCallStatus.RINGING -> PhoneCallStatus.RINGING
        com.kreativekoala.summaryai.data.api.models.PhoneCallStatus.IN_PROGRESS -> PhoneCallStatus.IN_PROGRESS
        com.kreativekoala.summaryai.data.api.models.PhoneCallStatus.RECORDING -> PhoneCallStatus.RECORDING
        com.kreativekoala.summaryai.data.api.models.PhoneCallStatus.COMPLETED -> PhoneCallStatus.COMPLETED
        com.kreativekoala.summaryai.data.api.models.PhoneCallStatus.FAILED -> PhoneCallStatus.FAILED
        com.kreativekoala.summaryai.data.api.models.PhoneCallStatus.BUSY -> PhoneCallStatus.BUSY
        com.kreativekoala.summaryai.data.api.models.PhoneCallStatus.NO_ANSWER -> PhoneCallStatus.NO_ANSWER
        com.kreativekoala.summaryai.data.api.models.PhoneCallStatus.CANCELLED -> PhoneCallStatus.CANCELLED
    },
    isRecording = isRecording,
    recordingUrl = recordingUrl,
    recordingDuration = recordingDuration,
    recordingId = recordingId,
    startedAt = startedAt,
    answeredAt = answeredAt,
    recordingStartedAt = recordingStartedAt,
    endedAt = endedAt,
    createdAt = createdAt,
    updatedAt = updatedAt
)
