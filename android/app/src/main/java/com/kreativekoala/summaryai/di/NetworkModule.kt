package com.kreativekoala.summaryai.di

import com.kreativekoala.summaryai.BuildConfig
import com.kreativekoala.summaryai.data.api.AuthInterceptor
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.local.SubscriptionStatus
import com.kreativekoala.summaryai.data.local.TokenManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

/**
 * Hilt module for network-related dependencies
 */
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideAuthInterceptor(
        tokenManager: TokenManager,
        subscriptionStatus: SubscriptionStatus
    ): AuthInterceptor = AuthInterceptor(tokenManager, subscriptionStatus)

    @Provides
    @Singleton
    fun provideLoggingInterceptor(): HttpLoggingInterceptor {
        return HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BODY
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(
        authInterceptor: AuthInterceptor,
        loggingInterceptor: HttpLoggingInterceptor
    ): OkHttpClient {
        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    @UploadClient
    fun provideUploadOkHttpClient(
        loggingInterceptor: HttpLoggingInterceptor
    ): OkHttpClient {
        // Separate client for direct-to-storage audio uploads. The signed URL already
        // carries auth, so no AuthInterceptor. Timeouts are sized for long uploads —
        // a 1-hour M4A at 128kbps is ~57MB and can take several minutes on cellular.
        return OkHttpClient.Builder()
            .addInterceptor(loggingInterceptor)
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(0, TimeUnit.MILLISECONDS) // no overall write timeout
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(
        okHttpClient: OkHttpClient
    ): Retrofit {
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL + "/")
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    @Provides
    @Singleton
    fun provideSummaryAIApi(
        retrofit: Retrofit
    ): SummaryAIApi = retrofit.create(SummaryAIApi::class.java)

    @Provides
    @Singleton
    fun provideCoachingApi(
        retrofit: Retrofit
    ): com.kreativekoala.summaryai.data.api.coaching.CoachingApi =
        retrofit.create(com.kreativekoala.summaryai.data.api.coaching.CoachingApi::class.java)
}
