package com.kreativekoala.summaryai.di

import android.content.Context
import com.kreativekoala.summaryai.BuildConfig
import com.kreativekoala.summaryai.data.auth.EncryptedSessionManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import javax.inject.Singleton

/**
 * ONE Supabase client for the whole app. Sign-in, the OkHttp AuthInterceptor and token refresh must all
 * share its session: two clients each rotate the (single-use) refresh token and invalidate each other's copy.
 */
@Module
@InstallIn(SingletonComponent::class)
object SupabaseModule {
    @Provides
    @Singleton
    fun provideSupabaseClient(@ApplicationContext context: Context): SupabaseClient = createSupabaseClient(
        supabaseUrl = BuildConfig.SUPABASE_URL,
        supabaseKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY
    ) {
        install(Auth) {
            // The session (access + refresh token, email) lives in the encrypted store, never in clear text.
            sessionManager = EncryptedSessionManager.create(context)
        }
    }
}
