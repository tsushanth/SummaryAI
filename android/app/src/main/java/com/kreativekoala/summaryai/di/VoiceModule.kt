package com.kreativekoala.summaryai.di

import com.kreativekoala.summaryai.BuildConfig
import com.kreativekoala.summaryai.data.repository.TodosRepository
import com.kreativekoala.summaryai.service.voice.RetrofitVoiceToolsClient
import com.kreativekoala.summaryai.service.voice.TodoMutations
import com.kreativekoala.summaryai.service.voice.VoiceToolsClient
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Named
import javax.inject.Inject
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class VoiceBindingsModule {
    @Binds
    abstract fun bindVoiceToolsClient(impl: RetrofitVoiceToolsClient): VoiceToolsClient

    @Binds
    abstract fun bindTodoMutations(impl: RepositoryTodoMutations): TodoMutations
}

@Module
@InstallIn(SingletonComponent::class)
object VoiceFlagModule {
    @Provides
    @Named("voiceBuildEnabled")
    fun provideVoiceBuildEnabled(): Boolean = BuildConfig.VOICE_ACTIONS_ENABLED
}

/** Completing and removing todos for the voice session, through the same repository the Todos screen uses. */
@Singleton
class RepositoryTodoMutations @Inject constructor(private val repo: TodosRepository) : TodoMutations {
    override suspend fun setCompleted(id: String, completed: Boolean): Boolean = repo.toggleTodo(id, completed).isSuccess
    override suspend fun delete(id: String): Boolean = repo.deleteTodo(id).isSuccess
}
