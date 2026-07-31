package com.kreativekoala.summaryai.data.api.coaching

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Streaming
import retrofit2.http.Url
import okhttp3.ResponseBody

/**
 * Retrofit interface for the realtime coaching API. The SSE stream uses
 * `@Streaming` so the response body isn't buffered.
 */
interface CoachingApi {
    @POST("api/coaching/credits/claim-free")
    suspend fun claimFreeCredits(): CoachingClaimFreeResponse

    /** DEBUG only — grants 5 credits per call so we can test before real IAPs ship. */
    @POST("api/coaching/credits/grant-debug")
    suspend fun debugGrantCredits(): CoachingDebugGrantResponse

    @GET("api/coaching/credits")
    suspend fun getCredits(): CoachingCredits

    @POST("api/coaching/sessions")
    suspend fun startSession(@Body body: CoachingStartSessionRequest): CoachingStartSessionResponse

    @POST("api/coaching/sessions/{id}/end")
    suspend fun endSession(@Path("id") sessionId: String): CoachingEndResponse

    @GET("api/coaching/sessions/{id}/insights")
    suspend fun getInsights(@Path("id") sessionId: String): CoachingInsightsResponse

    @Streaming
    @GET
    suspend fun streamInsights(@Url url: String): ResponseBody

    @POST("api/coaching/iap/google-play/verify")
    suspend fun verifyGooglePlayPurchase(@Body body: CoachingGooglePlayVerifyRequest): CoachingGooglePlayVerifyResponse
}
