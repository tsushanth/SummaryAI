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
        @Query("order") order: String = "desc"
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

    @POST("api/recordings/{id}/ask")
    suspend fun askQuestion(
        @Path("id") id: String,
        @Body request: AskQuestionRequest
    ): AskQuestionResponse

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

    // MARK: - Meetings

    @GET("api/meetings")
    suspend fun getMeetings(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
        @Query("status") status: String? = null,
        @Query("upcoming") upcoming: Boolean? = null
    ): ListMeetingsResponse

    @GET("api/meetings/{id}")
    suspend fun getMeeting(
        @Path("id") id: String
    ): MeetingResponse

    @POST("api/meetings/join")
    suspend fun joinMeeting(
        @Body request: JoinMeetingRequest
    ): JoinMeetingResponse

    @POST("api/meetings/{id}/schedule-bot")
    suspend fun scheduleMeetingBot(
        @Path("id") id: String,
        @Body request: ScheduleMeetingBotRequest
    ): MeetingResponse

    @DELETE("api/meetings/{id}/bot")
    suspend fun cancelMeetingBot(
        @Path("id") id: String
    ): Response<Unit>

    // MARK: - Calendar

    @GET("api/calendar/connections")
    suspend fun getCalendarConnections(): CalendarConnectionsResponse

    @GET("api/calendar/auth/{provider}")
    suspend fun getCalendarAuthUrl(
        @Path("provider") provider: String,
        @Query("redirect_uri") redirectUri: String
    ): CalendarAuthUrlResponse

    @DELETE("api/calendar/connections/{provider}")
    suspend fun disconnectCalendar(
        @Path("provider") provider: String
    ): Response<Unit>

    @POST("api/calendar/sync")
    suspend fun syncCalendar(): Response<Unit>

    // MARK: - User

    @GET("api/users/profile")
    suspend fun getUserProfile(): UserProfileResponse

    @DELETE("api/users/account")
    suspend fun deleteAccount(): Response<Unit>
}
