package com.kreativekoala.summaryai.data.api

import com.kreativekoala.summaryai.data.api.models.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit API interface for Summary AI backend
 */
interface SummaryAIApi {

    // MARK: - Health

    @GET("health")
    suspend fun healthCheck(): Response<Unit>

    // MARK: - Recordings

    @POST("api/recordings")
    suspend fun createRecording(
        @Body request: CreateRecordingRequest
    ): CreateRecordingResponse

    @GET("api/recordings")
    suspend fun getRecordings(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("status") status: String? = null,
        @Query("sort") sort: String = "created_at",
        @Query("order") order: String = "desc",
        @Query("folder_id") folderId: String? = null,
        @Query("tag") tag: String? = null,
        @Query("favorite") favorite: Boolean? = null,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null
    ): ListRecordingsResponse

    @GET("api/recordings/{id}")
    suspend fun getRecording(
        @Path("id") id: String,
        @Query("include") include: String? = null // "transcript,summary"
    ): GetRecordingResponse

    @DELETE("api/recordings/{id}")
    suspend fun deleteRecording(
        @Path("id") id: String
    ): Response<Unit>

    @POST("api/recordings/{id}/complete-upload")
    suspend fun completeUpload(
        @Path("id") id: String,
        @Body request: CompleteUploadRequest
    ): CompleteUploadResponse

    @POST("api/recordings/{id}/questions")
    suspend fun askQuestion(
        @Path("id") id: String,
        @Body request: AskQuestionRequest
    ): AskQuestionResponse

    @PATCH("api/recordings/{id}/speakers")
    suspend fun updateSpeakerNames(
        @Path("id") id: String,
        @Body request: UpdateSpeakerNamesRequest
    ): UpdateSpeakerNamesResponse

    @PATCH("api/recordings/{id}")
    suspend fun updateRecording(
        @Path("id") id: String,
        @Body request: UpdateRecordingRequest
    ): UpdateRecordingResponse

    // MARK: - Todos

    @GET("api/todos")
    suspend fun getTodos(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 50,
        @Query("is_completed") isCompleted: Boolean? = null,
        @Query("recording_id") recordingId: String? = null,
        @Query("sort") sort: String = "created_at",
        @Query("order") order: String = "desc"
    ): ListTodosResponse

    @POST("api/todos")
    suspend fun createTodo(
        @Body request: CreateTodoRequest
    ): TodoResponse

    @GET("api/todos/{id}")
    suspend fun getTodo(
        @Path("id") id: String
    ): TodoResponse

    @PATCH("api/todos/{id}")
    suspend fun updateTodo(
        @Path("id") id: String,
        @Body request: UpdateTodoRequest
    ): TodoResponse

    @DELETE("api/todos/{id}")
    suspend fun deleteTodo(
        @Path("id") id: String
    ): Response<Unit>

    // MARK: - Intelligence (templates, regenerate, follow-up email, action items, chat)

    @GET("api/summary-templates")
    suspend fun getSummaryTemplates(): SummaryTemplatesResponse

    @PUT("api/summary-templates/default")
    suspend fun setDefaultSummaryTemplate(
        @Body request: SetDefaultTemplateRequest
    ): DefaultTemplateResponse

    @POST("api/recordings/{id}/regenerate-summary")
    suspend fun regenerateSummary(
        @Path("id") id: String,
        @Body request: RegenerateSummaryRequest
    ): RegenerateSummaryResponse

    @POST("api/recordings/{id}/follow-up-email")
    suspend fun followUpEmail(
        @Path("id") id: String,
        @Body request: FollowUpEmailRequest
    ): FollowUpEmailResponse

    @POST("api/recordings/{id}/action-items-to-todos")
    suspend fun actionItemsToTodos(
        @Path("id") id: String
    ): ActionItemsToTodosResponse

    @POST("api/chat")
    suspend fun chatAcrossMeetings(
        @Body request: CrossMeetingChatRequest
    ): CrossMeetingChatResponse

    // MARK: - Meetings

    @GET("api/meetings")
    suspend fun getMeetings(
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
        @Query("status") status: String? = null,
        @Query("days_ahead") daysAhead: Int? = null
    ): ListMeetingsResponse

    @GET("api/meetings/{id}")
    suspend fun getMeeting(
        @Path("id") id: String
    ): MeetingResponse

    @POST("api/meetings/join")
    suspend fun joinMeeting(
        @Body request: JoinMeetingRequest
    ): JoinMeetingResponse

    @PATCH("api/meetings/{id}")
    suspend fun updateMeeting(
        @Path("id") id: String,
        @Body request: UpdateMeetingRequest
    ): MeetingResponse

    @GET("api/meetings/{id}/live-transcript")
    suspend fun getLiveTranscript(
        @Path("id") meetingId: String,
        @Query("since") since: String? = null
    ): LiveTranscriptResponse

    @GET("api/meetings/{id}/live-transcript/stitched")
    suspend fun getStitchedLiveTranscript(
        @Path("id") meetingId: String
    ): StitchedLiveTranscriptResponse

    // MARK: - Calendar

    @GET("api/calendar/connections")
    suspend fun getCalendarConnections(): CalendarConnectionsResponse

    @POST("api/calendar/connect/{provider}")
    suspend fun connectCalendar(
        @Path("provider") provider: String
    ): CalendarAuthUrlResponse

    @DELETE("api/calendar/connections/{provider}")
    suspend fun disconnectCalendar(
        @Path("provider") provider: String
    ): Response<Unit>

    @POST("api/calendar/sync")
    suspend fun syncCalendar(): Response<Unit>

    // MARK: - Integrations

    @GET("api/integrations")
    suspend fun getIntegrations(): IntegrationsResponse

    @PUT("api/integrations/{kind}")
    suspend fun saveIntegration(
        @Path("kind") kind: String,
        @Body body: IntegrationUpsertRequest
    ): IntegrationResponse

    @DELETE("api/integrations/{kind}")
    suspend fun deleteIntegration(
        @Path("kind") kind: String
    ): Response<Unit>

    @POST("api/integrations/{kind}/test")
    suspend fun testIntegration(
        @Path("kind") kind: String
    ): IntegrationTestResponse

    @GET("api/integrations/deliveries")
    suspend fun getIntegrationDeliveries(): IntegrationDeliveriesResponse

    @GET("api/recordings/{id}/analytics")
    suspend fun getMeetingAnalytics(
        @Path("id") recordingId: String
    ): MeetingAnalyticsResponse

    @GET("api/stats/weekly")
    suspend fun getWeeklyStats(): com.kreativekoala.summaryai.data.api.models.WeeklyStatsDto

    // MARK: - User

    @GET("api/users/profile")
    suspend fun getUserProfile(): UserProfileResponse

    @DELETE("api/users/account")
    suspend fun deleteAccount(): Response<Unit>

    // MARK: - Phone Verification

    @POST("api/phone/verify/send")
    suspend fun sendVerificationCode(
        @Body request: SendVerificationRequest
    ): SendVerificationResponse

    @POST("api/phone/verify/check")
    suspend fun checkVerificationCode(
        @Body request: CheckVerificationRequest
    ): CheckVerificationResponse

    @GET("api/phone/verified")
    suspend fun getVerifiedPhones(): VerifiedPhonesResponse

    @DELETE("api/phone/verified/{id}")
    suspend fun deleteVerifiedPhone(
        @Path("id") id: String
    ): Response<Unit>

    // MARK: - VoIP

    @GET("api/phone/voip/token")
    suspend fun getVoipToken(): VoipTokenResponse

    // MARK: - Phone Calls

    @POST("api/phone/calls")
    suspend fun createCall(
        @Body request: InitiateCallRequest
    ): CreateCallResponse

    @GET("api/phone/calls")
    suspend fun getPhoneCalls(
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0
    ): ListPhoneCallsResponse

    @GET("api/phone/calls/{id}")
    suspend fun getPhoneCall(
        @Path("id") id: String
    ): PhoneCallResponse

    @POST("api/phone/calls/{id}/record")
    suspend fun startCallRecording(
        @Path("id") callId: String
    ): RecordingControlResponse

    @DELETE("api/phone/calls/{id}/record")
    suspend fun stopCallRecording(
        @Path("id") callId: String
    ): RecordingControlResponse

    @POST("api/phone/calls/{id}/hangup")
    suspend fun hangupCall(
        @Path("id") callId: String
    ): HangupResponse

    // MARK: - Organization (folders, tags, public share links, search)

    @GET("api/folders")
    suspend fun getFolders(): FoldersResponse

    @POST("api/folders")
    suspend fun createFolder(@Body request: FolderNameRequest): FolderResponse

    @PATCH("api/folders/{id}")
    suspend fun renameFolder(
        @Path("id") id: String,
        @Body request: FolderNameRequest
    ): FolderResponse

    @DELETE("api/folders/{id}")
    suspend fun deleteFolder(@Path("id") id: String): Response<Unit>

    @GET("api/tags")
    suspend fun getTags(): TagsResponse

    /** Raw JSON body so that `{"folder_id":null}` (un-file) is actually sent; Gson drops null fields. */
    @PATCH("api/recordings/{id}")
    suspend fun setRecordingFolder(
        @Path("id") id: String,
        @Body body: RequestBody
    ): UpdateRecordingResponse

    @GET("api/recordings/{id}/shares")
    suspend fun getShares(@Path("id") id: String): SharesResponse

    @POST("api/recordings/{id}/shares")
    suspend fun createShare(
        @Path("id") id: String,
        @Body request: CreateShareRequest
    ): CreateShareResponse

    @DELETE("api/recordings/{id}/shares/{shareId}")
    suspend fun revokeShare(
        @Path("id") id: String,
        @Path("shareId") shareId: String
    ): Response<Unit>

    @GET("api/search")
    suspend fun searchRecordings(@Query("q") query: String, @Query("limit") limit: Int = 50): SearchResponse
}
