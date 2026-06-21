package com.kreativekoala.summaryai.ui.livecaption

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Live Caption — deaf / hard-of-hearing focused streaming transcript.
 *
 * Tuned for utility over polish:
 *   - One enormous tap target to start / stop listening (works even when
 *     the phone is across a table or in a stand).
 *   - 28sp transcript text (vs ~14sp default body) — readable at arm's
 *     length without a magnifier.
 *   - High contrast scheme (white on near-black) so the screen stays
 *     legible in a sunny coffee shop.
 *   - Status block is a Compose ``liveRegion`` so a sighted-with-low-vision
 *     user using TalkBack still gets state-change announcements.
 *   - Auto-scrolls to bottom on each transcript update.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LiveCaptionScreen(
    onNavigateBack: () -> Unit,
    viewModel: LiveCaptionViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    // Track RECORD_AUDIO permission. The user can also have granted it
    // earlier for the meeting recording flow — we re-check on entry.
    var hasMicPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        )
    }
    val requestMic = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasMicPermission = granted
        if (granted) viewModel.toggle()
    }

    // Auto-scroll to the bottom whenever the transcript grows. Short
    // debounce keeps it smooth on bursts of partials.
    LaunchedEffect(state.transcript) {
        if (state.transcript.isNotEmpty()) {
            delay(100)
            scrollState.animateScrollTo(scrollState.maxValue)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Live Caption",
                        modifier = Modifier.semantics { heading() },
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.Filled.ArrowBack,
                            contentDescription = "Back",
                        )
                    }
                },
            )
        },
        containerColor = Color(0xFF111111), // high-contrast dark base
    ) { padding ->
        LiveCaptionContent(
            padding = padding,
            state = state,
            scrollState = scrollState,
            hasMicPermission = hasMicPermission,
            onToggle = {
                if (hasMicPermission) {
                    viewModel.toggle()
                } else {
                    requestMic.launch(Manifest.permission.RECORD_AUDIO)
                }
            },
        )
    }
}

@Composable
private fun LiveCaptionContent(
    padding: PaddingValues,
    state: LiveCaptionViewModel.UiState,
    scrollState: androidx.compose.foundation.ScrollState,
    hasMicPermission: Boolean,
    onToggle: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
            .background(Color(0xFF111111))
            .padding(horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // ---- Status line (live region so TalkBack announces) ----
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp, bottom = 12.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            val statusText = when {
                !hasMicPermission -> "Microphone permission needed. Tap the mic button to allow."
                state.errorMessage != null -> "Error: ${state.errorMessage}"
                state.isListening -> "Listening…"
                else -> "Tap the mic to start"
            }
            Text(
                text = statusText,
                style = MaterialTheme.typography.bodyLarge.copy(
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Medium,
                ),
                color = if (state.isListening) Color(0xFF9CDCFE) else Color.LightGray,
                textAlign = TextAlign.Center,
            )
            if (!state.onDeviceAvailable) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Using cloud recognition on this device. Audio leaves the phone.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFFFFB86C),
                    textAlign = TextAlign.Center,
                )
            }
        }

        // ---- Transcript area: large text, scrollable, takes all available space ----
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f, fill = true)
                .background(
                    color = Color(0xFF1A1A1A),
                    shape = RoundedCornerShape(12.dp),
                )
                .padding(16.dp)
                .verticalScroll(scrollState),
            contentAlignment = Alignment.TopStart,
        ) {
            if (state.transcript.isBlank()) {
                Text(
                    text = if (state.isListening)
                        "Speak nearby and the words will appear here."
                    else
                        "Captions will appear here once you start listening.",
                    fontSize = 18.sp,
                    color = Color.Gray,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                Text(
                    text = state.transcript,
                    fontSize = 28.sp,
                    lineHeight = 36.sp,
                    color = Color.White,
                    modifier = Modifier
                        .fillMaxWidth()
                        .semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }

        // ---- Giant toggle button ----
        Spacer(modifier = Modifier.height(20.dp))
        Button(
            onClick = onToggle,
            modifier = Modifier
                .fillMaxWidth()
                .height(96.dp)
                .padding(bottom = 12.dp)
                .semantics {
                    contentDescription = if (state.isListening) {
                        "Stop listening"
                    } else {
                        "Start listening"
                    }
                },
            shape = RoundedCornerShape(20.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = if (state.isListening) Color(0xFFB00020) else Color(0xFF1E88E5),
            ),
        ) {
            Icon(
                imageVector = if (state.isListening) Icons.Filled.MicOff else Icons.Filled.Mic,
                contentDescription = null,
                modifier = Modifier.size(36.dp),
                tint = Color.White,
            )
            Spacer(modifier = Modifier.size(12.dp))
            Text(
                text = if (state.isListening) "Stop" else "Start",
                fontSize = 22.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color.White,
            )
        }
    }
}
