package com.kreativekoala.summaryai.ui.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.service.AuthService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val authService: AuthService
) : ViewModel() {

    fun completeOnboarding() {
        viewModelScope.launch {
            authService.setOnboardingCompleted()
        }
    }
}
