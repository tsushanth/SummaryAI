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

    @Binds
    abstract fun bindPhoneDevice(impl: com.kreativekoala.summaryai.util.AndroidPhoneDevice): com.kreativekoala.summaryai.util.PhoneDevice

    @Binds
    abstract fun bindOwnNumberSource(impl: com.kreativekoala.summaryai.data.repository.PhoneRepository): com.kreativekoala.summaryai.data.repository.OwnNumberSource

    @Binds
    abstract fun bindPhoneSource(impl: com.kreativekoala.summaryai.data.repository.PhoneRepository): com.kreativekoala.summaryai.data.repository.PhoneSource

    @Binds
    abstract fun bindPhonePurchases(impl: com.kreativekoala.summaryai.service.PlayPhonePurchases): com.kreativekoala.summaryai.service.PhonePurchases
}
