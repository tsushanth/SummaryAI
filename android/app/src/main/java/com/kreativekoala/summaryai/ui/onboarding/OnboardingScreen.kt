package com.kreativekoala.summaryai.ui.onboarding

import androidx.compose.runtime.Composable

/**
 * The 4-slide intro was removed: it sat between sign-in and the first recording and carried no information the
 * Record screen does not. What remains of onboarding is the email screen, shown only when the account has no
 * email on file (see [FirstRunRouting]).
 */
@Composable
fun OnboardingScreen(onComplete: () -> Unit) {
    EmailCaptureScreen(onContinue = onComplete)
}
