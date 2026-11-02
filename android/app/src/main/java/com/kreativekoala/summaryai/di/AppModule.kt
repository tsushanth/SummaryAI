package com.kreativekoala.summaryai.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import com.kreativekoala.summaryai.data.local.PreferencesManager
import com.kreativekoala.summaryai.data.local.TokenManager
import com.kreativekoala.summaryai.data.sample.SampleMeetingStore
import com.kreativekoala.summaryai.ui.onboarding.FirstRunState
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

// Extension property for DataStore
private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "summary_ai_preferences")

/**
 * Hilt module for app-wide dependencies
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideDataStore(
        @ApplicationContext context: Context
    ): DataStore<Preferences> = context.dataStore

    @Provides
    @Singleton
    fun providePreferencesManager(
        dataStore: DataStore<Preferences>
    ): PreferencesManager = PreferencesManager(dataStore)

    @Provides
    @Singleton
    fun provideSampleMeetingStore(
        @ApplicationContext context: Context
    ): SampleMeetingStore = SampleMeetingStore(
        context.getSharedPreferences(SampleMeetingStore.PREFS_NAME, Context.MODE_PRIVATE)
    )

    @Provides
    @Singleton
    fun provideFirstRunState(
        @ApplicationContext context: Context
    ): FirstRunState = FirstRunState(
        context.getSharedPreferences(FirstRunState.PREFS_NAME, Context.MODE_PRIVATE)
    )

    @Provides
    @Singleton
    fun provideTokenManager(
        @ApplicationContext context: Context
    ): TokenManager = TokenManager(context)
}
