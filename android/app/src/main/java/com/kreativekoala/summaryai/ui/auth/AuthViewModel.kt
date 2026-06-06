package com.kreativekoala.summaryai.ui.auth

import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.domain.model.AuthState
import com.kreativekoala.summaryai.service.AuthService
import com.kreativekoala.summaryai.service.FacebookSDKHelper
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
            // Helper dedupes — safe to call on every successful sign-in; only the
            // first time per install actually fires CompleteRegistration to Meta.
            if (result.isSuccess) FacebookSDKHelper.logSignUp("google")
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
        authService.clearError()
    }

    fun signInWithEmail(email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = authService.signInWithEmail(email, password)
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                error = result.exceptionOrNull()?.message
            )
            if (result.isSuccess) FacebookSDKHelper.logSignUp("email")
        }
    }

    fun signUpWithEmail(email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = authService.signUpWithEmail(email, password)
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                error = result.exceptionOrNull()?.message
            )
            if (result.isSuccess) FacebookSDKHelper.logSignUp("email")
        }
    }

    fun signInAsDemo() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            authService.signInAsDemo()
            _uiState.value = _uiState.value.copy(isLoading = false)
        }
    }
}
