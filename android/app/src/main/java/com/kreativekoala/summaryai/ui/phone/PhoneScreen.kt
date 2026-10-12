package com.kreativekoala.summaryai.ui.phone

import android.Manifest
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import java.util.*


@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun PhoneScreen(
    viewModel: PhoneViewModel = hiltViewModel(),
    onRecordingClick: (String) -> Unit = {}
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsState()

    // Microphone permission required by Twilio Voice SDK
    var pendingCallAfterPermission by remember { mutableStateOf(false) }
    val micPermission = rememberPermissionState(Manifest.permission.RECORD_AUDIO) { granted ->
        if (granted && pendingCallAfterPermission) {
            pendingCallAfterPermission = false
            viewModel.initiateCall()
        }
    }

    // Error handling
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    // Function to make native phone call
    fun makeNativeCall(phoneNumber: String) {
        val cleanNumber = phoneNumber.filter { it.isDigit() || it == '+' }
        if (cleanNumber.isNotEmpty()) {
            val intent = Intent(Intent.ACTION_DIAL).apply {
                data = Uri.parse("tel:$cleanNumber")
            }
            context.startActivity(intent)
            viewModel.updateDialerNumber("") // Clear after dialing
        }
    }

    // Track if we should show the verification sheet (for AI recording feature)
    var showVerificationSheet by remember { mutableStateOf(false) }

    // Collect VoIP state
    val isMuted by viewModel.isMuted.collectAsState()
    val isSpeakerOn by viewModel.isSpeakerOn.collectAsState()

    // Show active call sheet when VoIP call is in progress
    if (uiState.hasActiveCall) {
        ActiveCallSheet(
            call = uiState.activeCall,
            callState = uiState.activeCallState,
            isMuted = isMuted,
            isSpeakerOn = isSpeakerOn,
            onToggleMute = { viewModel.toggleMute() },
            onToggleSpeaker = { viewModel.toggleSpeaker() },
            onHangup = { viewModel.hangupCall() },
            onDismiss = { viewModel.clearActiveCall() }
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(
                        text = "Phone",
                        style = MaterialTheme.typography.headlineMedium
                    )
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Tab selector - only Calls and Dialer for now
            TabRow(
                selectedTabIndex = if (uiState.selectedTab == PhoneTab.SETTINGS) 0 else uiState.selectedTab.ordinal,
                modifier = Modifier.fillMaxWidth()
            ) {
                Tab(
                    selected = uiState.selectedTab == PhoneTab.CALLS,
                    onClick = { viewModel.selectTab(PhoneTab.CALLS) },
                    text = { Text("Calls") }
                )
                Tab(
                    selected = uiState.selectedTab == PhoneTab.DIALER,
                    onClick = { viewModel.selectTab(PhoneTab.DIALER) },
                    text = { Text("Dialer") }
                )
            }

            // Content
            when (uiState.selectedTab) {
                PhoneTab.CALLS -> CallsContent(
                    calls = uiState.phoneCalls,
                    isLoading = uiState.isLoading,
                    isRefreshing = uiState.isRefreshing,
                    hasVerifiedPhone = uiState.hasVerifiedPhones,
                    onRefresh = { viewModel.refresh() },
                    onLoadMore = { viewModel.loadMoreCalls() },
                    onRecordingClick = onRecordingClick,
                    onCallClick = { call -> viewModel.callFromHistory(call) }
                )
                PhoneTab.DIALER, PhoneTab.SETTINGS -> NativeDialerContent(
                    dialerNumber = uiState.dialerNumber,
                    hasVerifiedPhone = uiState.hasVerifiedPhones,
                    onNumberChange = { viewModel.updateDialerNumber(it) },
                    onDigitClick = { viewModel.appendDialerDigit(it) },
                    onDeleteClick = { viewModel.deleteDialerDigit() },
                    onCallClick = { makeNativeCall(uiState.dialerNumber) },
                    onStartCall = {
                        if (micPermission.status.isGranted) {
                            viewModel.initiateCall()
                        } else {
                            pendingCallAfterPermission = true
                            micPermission.launchPermissionRequest()
                        }
                    },
                    onVerifyPhoneClick = { showVerificationSheet = true }
                )
            }
        }
    }

    // Verification bottom sheet (keep for future AI recording feature)
    if (showVerificationSheet) {
        VerificationBottomSheet(
            verificationState = uiState.verificationState,
            verificationPhoneNumber = uiState.verificationPhoneNumber,
            verificationCode = uiState.verificationCode,
            verificationError = uiState.verificationError,
            onPhoneNumberChange = { viewModel.updateVerificationPhoneNumber(it) },
            onCodeChange = { viewModel.updateVerificationCode(it) },
            onSendCode = { viewModel.sendVerificationCode() },
            onVerify = { viewModel.checkVerificationCode() },
            onReset = { viewModel.resetVerification() },
            onDismiss = {
                showVerificationSheet = false
                viewModel.resetVerification()
            }
        )
    }
}
