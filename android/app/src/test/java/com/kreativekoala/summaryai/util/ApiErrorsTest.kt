package com.kreativekoala.summaryai.util

import com.kreativekoala.summaryai.R
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class ApiErrorsTest {
    private val json = "application/json".toMediaType()

    private fun http(status: Int, body: String): HttpException =
        HttpException(Response.error<Any>(status, body.toResponseBody(json)))

    private fun envelope(code: String, message: String = "English message") = """{"error":{"code":"$code","message":"$message"}}"""

    @Test fun parsesCodeAndMessageFromTheErrorEnvelope() {
        val p = ApiErrors.parse(http(404, envelope("TODO_NOT_FOUND", "Todo not found")))
        assertEquals(404, p.status)
        assertEquals("TODO_NOT_FOUND", p.code)
        assertEquals("Todo not found", p.message)
    }

    @Test fun parsingDoesNotConsumeTheBody() {
        val e = http(404, envelope("TODO_NOT_FOUND"))
        ApiErrors.parse(e)
        assertEquals("TODO_NOT_FOUND", ApiErrors.parse(e).code)
        assertEquals(envelope("TODO_NOT_FOUND"), e.response()!!.errorBody()!!.string())
    }

    @Test fun knownCodesMapToResources() {
        assertEquals(R.string.api_error_todo_not_found, ApiErrors.resFor(http(404, envelope("TODO_NOT_FOUND"))))
        assertEquals(R.string.api_error_recording_not_transcribed, ApiErrors.resFor(http(422, envelope("RECORDING_NOT_TRANSCRIBED"))))
        assertEquals(R.string.api_error_calendar_provider_unavailable, ApiErrors.resFor(http(422, envelope("PROVIDER_NOT_CONFIGURED"))))
        assertEquals(R.string.error_qa_failed, ApiErrors.resFor(http(500, envelope("QA_FAILED"))))
        assertEquals(R.string.api_error_server, ApiErrors.resFor(http(500, envelope("INTERNAL_ERROR"))))
        assertEquals(R.string.api_error_rate_limited, ApiErrors.resFor(http(429, envelope("RATE_LIMITED"))))
    }

    @Test fun codesAreMatchedCaseInsensitively() {
        assertEquals(R.string.api_error_todo_not_found, ApiErrors.resForCode("todo_not_found"))
    }

    @Test fun anUnknownCodeWithAMessageFallsBackToTheServerMessage() {
        val e = http(409, envelope("SOMETHING_NEW", "Brand new problem"))
        assertNull(ApiErrors.resFor(e))
        assertEquals("Brand new problem", ApiErrors.parse(e).message)
    }

    @Test fun aBodylessHttpFailureMapsByStatus() {
        assertEquals(R.string.api_error_unauthorized, ApiErrors.resFor(http(401, "")))
        assertEquals(R.string.api_error_not_found, ApiErrors.resFor(http(404, "not json")))
        assertEquals(R.string.api_error_server, ApiErrors.resFor(http(503, "<html>")))
        assertEquals(R.string.api_error_invalid_request, ApiErrors.resFor(http(422, "")))
    }

    @Test fun networkFailuresGetTheNetworkMessage() {
        assertEquals(R.string.api_error_network, ApiErrors.resFor(IOException("Unable to resolve host")))
    }

    @Test fun aRefusedRequestShowsTheServersWords() {
        val e = http(400, envelope("BAD_REQUEST", "Unsupported meeting platform."))
        assertEquals("Unsupported meeting platform.", ApiErrors.refusalMessage(e))
    }

    @Test fun otherStatusesAndFailuresAreNotRefusals() {
        assertNull(ApiErrors.refusalMessage(http(500, envelope("INTERNAL_ERROR", "Failed to dispatch bot"))))
        assertNull(ApiErrors.refusalMessage(http(400, "")))
        assertNull(ApiErrors.refusalMessage(IOException("offline")))
    }

    @Test fun otherFailuresKeepTheirOwnMessage() {
        assertNull(ApiErrors.resFor(IllegalStateException("boom")))
    }
}
