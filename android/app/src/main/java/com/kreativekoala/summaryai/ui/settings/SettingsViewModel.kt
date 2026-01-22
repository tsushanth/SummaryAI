package com.kreativekoala.summaryai.ui.settings

import android.content.Context
import android.content.pm.PackageInfo
import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.preferences.ThemeMode
import com.kreativekoala.summaryai.data.preferences.ThemePreferences
import com.kreativekoala.summaryai.data.repository.CalendarRepository
import com.kreativekoala.summaryai.domain.model.User
import com.kreativekoala.summaryai.service.AuthService
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val user: User? = null,
    val isGuest: Boolean = false,
    val hasCalendarConnected: Boolean = false,
    val themeMode: ThemeMode = ThemeMode.LIGHT,
    val appVersion: String = "",
    val buildNumber: String = "",
    val isDeleting: Boolean = false,
    val signedOut: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val authService: AuthService,
    private val calendarRepository: CalendarRepository,
    private val themePreferences: ThemePreferences
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        loadData()
        loadAppInfo()
        loadThemePreference()
    }

    private fun loadData() {
        viewModelScope.launch {
            // Get user from auth state
            authService.authState.collect { authState ->
                _uiState.value = _uiState.value.copy(
                    user = authState.user,
                    isGuest = authState.hasSkippedSignIn && !authState.isAuthenticated
                )
            }
        }

        viewModelScope.launch {
            // Check calendar connections
            val result = calendarRepository.getConnections()
            result.onSuccess { connections ->
                _uiState.value = _uiState.value.copy(
                    hasCalendarConnected = connections.any { it.syncEnabled }
                )
            }
        }
    }

    private fun loadThemePreference() {
        viewModelScope.launch {
            themePreferences.themeMode.collect { mode ->
                _uiState.value = _uiState.value.copy(themeMode = mode)
            }
        }
    }

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch {
            themePreferences.setThemeMode(mode)
        }
    }

    private fun loadAppInfo() {
        try {
            val packageInfo: PackageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(context.packageName, 0)
            }

            _uiState.value = _uiState.value.copy(
                appVersion = packageInfo.versionName ?: "1.0.0",
                buildNumber = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    packageInfo.longVersionCode.toString()
                } else {
                    @Suppress("DEPRECATION")
                    packageInfo.versionCode.toString()
                }
            )
        } catch (e: Exception) {
            _uiState.value = _uiState.value.copy(
                appVersion = "1.0.0",
                buildNumber = "1"
            )
        }
    }

    fun signOut() {
        viewModelScope.launch {
            authService.signOut()
            _uiState.value = _uiState.value.copy(signedOut = true)
        }
    }

    fun deleteAccount() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isDeleting = true)

            val result = authService.deleteAccount()

            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        isDeleting = false,
                        signedOut = true
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isDeleting = false,
                        error = error.message
                    )
                }
            )
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
