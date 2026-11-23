package com.kreativekoala.summaryai.di

import com.kreativekoala.summaryai.util.OutputLanguageSource
import com.kreativekoala.summaryai.util.PreferenceOutputLanguage
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class LanguageModule {
    @Binds
    abstract fun bindOutputLanguageSource(impl: PreferenceOutputLanguage): OutputLanguageSource
}
