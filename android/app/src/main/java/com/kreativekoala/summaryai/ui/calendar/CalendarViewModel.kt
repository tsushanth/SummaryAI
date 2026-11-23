package com.kreativekoala.summaryai.ui.calendar

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.local.TokenManager
import com.kreativekoala.summaryai.util.ApiErrors
import com.kreativekoala.summaryai.util.appLocaleContext
import com.kreativekoala.summaryai.data.repository.CalendarRepository
import com.kreativekoala.summaryai.domain.model.CalendarConnection
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CalendarUiState(
    val connections: List<CalendarConnection> = emptyList(),
    val isLoading: Boolean = false,
    val oauthUrl: String? = null,
    val error: String? = null
)

@HiltViewModel
class CalendarViewModel @Inject constructor(
    private val calendarRepository: CalendarRepository,
    private val tokenManager: TokenManager,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val isDemoMode: Boolean
        get() = tokenManager.userId?.startsWith("demo-user-") == true

    private val _uiState = MutableStateFlow(CalendarUiState())
    val uiState: StateFlow<CalendarUiState> = _uiState.asStateFlow()

    init {
        loadConnections()
    }

    fun loadConnections() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            val result = calendarRepository.getConnections()

            result.fold(
                onSuccess = { connections ->
                    _uiState.value = _uiState.value.copy(
                        connections = connections,
                        isLoading = false,
                        error = null
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = ApiErrors.userMessage(context, error)
                    )
                }
            )
        }
    }

    fun connectGoogle() {
        if (isDemoMode) {
            _uiState.value = _uiState.value.copy(error = appLocaleContext(context).getString(R.string.calendar_demo_mode_message))
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            val result = calendarRepository.getAuthUrl("google")

            result.fold(
                onSuccess = { url ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        oauthUrl = url
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = ApiErrors.userMessage(context, error)
                    )
                }
            )
        }
    }

    fun connectMicrosoft() {
        if (isDemoMode) {
            _uiState.value = _uiState.value.copy(error = appLocaleContext(context).getString(R.string.calendar_demo_mode_message))
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            val result = calendarRepository.getAuthUrl("microsoft")

            result.fold(
                onSuccess = { url ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        oauthUrl = url
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = ApiErrors.userMessage(context, error)
                    )
                }
            )
        }
    }

    fun disconnect(provider: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            val result = calendarRepository.disconnect(provider)

            result.fold(
                onSuccess = {
                    loadConnections()
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = ApiErrors.userMessage(context, error)
                    )
                }
            )
        }
    }

    fun clearOAuthUrl() {
        _uiState.value = _uiState.value.copy(oauthUrl = null)
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
