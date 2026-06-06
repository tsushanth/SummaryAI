package com.kreativekoala.summaryai.ui.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.paywallkit.manager.PaywallManager
import kotlinx.coroutines.delay

/**
 * Email capture screen shown at the end of onboarding, before the recordings
 * tab loads. Framed as "save your progress, get tips" rather than asking for
 * email in exchange for a trial — pattern gets ~2× the opt-in rate.
 *
 * Captured email is stored via [PaywallManager.setUserEmail] so all subsequent
 * paywall events automatically carry it for non-converter drip and paid
 * retargeting (Meta / TikTok Custom Audiences).
 */
@Composable
fun EmailCaptureScreen(
    onContinue: () -> Unit
) {
    val context = LocalContext.current
    var email by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }

    val isValid = remember(email) {
        val trimmed = email.trim()
        trimmed.contains("@") && trimmed.contains(".") && trimmed.length >= 5
    }

    LaunchedEffect(Unit) {
        delay(400) // let the screen settle before keyboard pops
        focusRequester.requestFocus()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(24.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.weight(1f))

            // Icon
            Box(
                modifier = Modifier
                    .size(96.dp)
                    .clip(CircleShape)
                    .background(
                        Brush.linearGradient(
                            colors = listOf(Color(0xFF2196F3), Color(0xFF00BCD4))
                        )
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Email,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(40.dp)
                )
            }

            Spacer(Modifier.height(32.dp))

            Text(
                text = "Save your progress",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )

            Spacer(Modifier.height(12.dp))

            Text(
                text = "Drop your email so your recordings sync across devices and we can send you the occasional tip.",
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 16.dp)
            )

            Spacer(Modifier.height(32.dp))

            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                placeholder = { Text("you@email.com") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester)
            )

            Spacer(Modifier.weight(1f))

            Button(
                onClick = {
                    val trimmed = email.trim().lowercase()
                    if (!isValid) return@Button
                    isSubmitting = true
                    // Persist immediately so any subsequent paywall event auto-attaches.
                    PaywallManager.setUserEmail(context, trimmed)
                    // Anchor event for drip timing.
                    PaywallManager.trackEvent(
                        appId = "meetingmind",
                        placement = "onboarding",
                        templateId = "email_capture",
                        event = "email_captured",
                        email = trimmed
                    )
                    onContinue()
                },
                enabled = isValid && !isSubmitting,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = Color.White,
                        strokeWidth = 2.dp
                    )
                } else {
                    Text("Continue", fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(8.dp))
                    Icon(Icons.Default.ArrowForward, contentDescription = null)
                }
            }

            Spacer(Modifier.height(8.dp))

            TextButton(onClick = onContinue) {
                Text(
                    "Skip for now",
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
            }

            Spacer(Modifier.height(16.dp))
        }
    }
}
