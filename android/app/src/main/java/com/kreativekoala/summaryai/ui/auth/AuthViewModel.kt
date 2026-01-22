package com.kreativekoala.summaryai.ui.auth

import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.domain.model.AuthState
import com.kreativekoala.summaryai.service.AuthService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthUiState(
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authService: AuthService
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    val authState: StateFlow<AuthState> = authService.authState

    fun getGoogleSignInIntent(): Intent {
        return authService.getGoogleSignInIntent()
    }

    fun handleGoogleSignInResult(data: Intent?) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = authService.handleGoogleSignInResult(data)
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                error = result.exceptionOrNull()?.message
            )
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
        authService.clearError()
    }

    fun continueWithoutSignIn() {
        viewModelScope.launch {
            authService.continueWithoutSignIn()
        }
    }
}
