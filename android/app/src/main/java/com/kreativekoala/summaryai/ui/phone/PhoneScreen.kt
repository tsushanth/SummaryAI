package com.kreativekoala.summaryai.ui.phone

import android.Manifest
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.SheetValue
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.kreativekoala.summaryai.domain.model.PhoneCall
import com.kreativekoala.summaryai.domain.model.PhoneCallStatus
import com.kreativekoala.summaryai.domain.model.VerifiedPhone
import java.text.SimpleDateFormat
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

@Composable
private fun CallsContent(
    calls: List<PhoneCall>,
    isLoading: Boolean,
    isRefreshing: Boolean,
    hasVerifiedPhone: Boolean,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onRecordingClick: (String) -> Unit,
    onCallClick: (PhoneCall) -> Unit
) {
    if (isLoading && calls.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator()
        }
    } else if (calls.isEmpty()) {
        EmptyCallsContent()
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(calls) { call ->
                PhoneCallCard(
                    call = call,
                    onRecordingClick = onRecordingClick,
                    onCallClick = if (hasVerifiedPhone) onCallClick else null
                )
            }

            item {
                LaunchedEffect(Unit) {
                    onLoadMore()
                }
            }
        }
    }
}

@Composable
private fun PhoneCallCard(
    call: PhoneCall,
    onRecordingClick: (String) -> Unit,
    onCallClick: ((PhoneCall) -> Unit)? = null
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (onCallClick != null) {
                    Modifier.clickable { onCallClick(call) }
                } else {
                    Modifier
                }
            ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Status icon
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(
                        when (call.status) {
                            PhoneCallStatus.COMPLETED -> Color(0xFF4CAF50).copy(alpha = 0.15f)
                            PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Color(0xFF2196F3).copy(alpha = 0.15f)
                            PhoneCallStatus.RINGING -> Color(0xFFFF9800).copy(alpha = 0.15f)
                            PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Color(0xFFF44336).copy(alpha = 0.15f)
                            else -> MaterialTheme.colorScheme.surfaceVariant
                        }
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = when (call.status) {
                        PhoneCallStatus.COMPLETED -> Icons.Default.PhoneCallback
                        PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Icons.Default.Phone
                        PhoneCallStatus.RINGING -> Icons.Default.PhoneInTalk
                        PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Icons.Default.PhoneMissed
                        else -> Icons.Default.Phone
                    },
                    contentDescription = null,
                    tint = when (call.status) {
                        PhoneCallStatus.COMPLETED -> Color(0xFF4CAF50)
                        PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Color(0xFF2196F3)
                        PhoneCallStatus.RINGING -> Color(0xFFFF9800)
                        PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Color(0xFFF44336)
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            // Call info
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = call.toName ?: call.formattedToNumber,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = call.status.displayName,
                        style = MaterialTheme.typography.bodySmall,
                        color = when (call.status) {
                            PhoneCallStatus.COMPLETED -> Color(0xFF4CAF50)
                            PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Color(0xFF2196F3)
                            PhoneCallStatus.RINGING -> Color(0xFFFF9800)
                            PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Color(0xFFF44336)
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )

                    call.recordingDuration?.let {
                        Text(
                            text = "• ${call.formattedDuration}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    if (call.isRecording) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(Color.Red)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "Recording",
                                style = MaterialTheme.typography.bodySmall,
                                color = Color.Red
                            )
                        }
                    }
                }
            }

            // Timestamp and recording link
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = formatCallDate(call.startedAt ?: call.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                call.recordingId?.let { recordingId ->
                    TextButton(
                        onClick = { onRecordingClick(recordingId) },
                        contentPadding = PaddingValues(0.dp)
                    ) {
                        Icon(
                            Icons.Default.GraphicEq,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Recording", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            // Show call button if callback available
            if (onCallClick != null) {
                Spacer(modifier = Modifier.width(8.dp))
                IconButton(
                    onClick = { onCallClick(call) }
                ) {
                    Icon(
                        Icons.Default.Phone,
                        contentDescription = "Call",
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }
    }
}

@Composable
private fun EmptyCallsContent() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Phone,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "No calls yet",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Medium
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Make a call using the dialer to get started",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DialerContent(
    dialerNumber: String,
    dialerContactName: String,
    selectedPhone: VerifiedPhone?,
    verifiedPhones: List<VerifiedPhone>,
    hasVerifiedPhones: Boolean,
    onNumberChange: (String) -> Unit,
    onContactNameChange: (String) -> Unit,
    onDigitClick: (String) -> Unit,
    onDeleteClick: () -> Unit,
    onPhoneSelect: (VerifiedPhone) -> Unit,
    onCallClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Phone number display
        OutlinedTextField(
            value = dialerNumber,
            onValueChange = onNumberChange,
            modifier = Modifier.fillMaxWidth(),
            textStyle = LocalTextStyle.current.copy(
                fontSize = 24.sp,
                textAlign = TextAlign.Center
            ),
            placeholder = { Text("Phone number", textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(4.dp))

        // Contact name
        OutlinedTextField(
            value = dialerContactName,
            onValueChange = onContactNameChange,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Contact name (optional)") },
            singleLine = true
        )

        Spacer(modifier = Modifier.height(8.dp))

        // Phone selector - moved above dial pad
        if (verifiedPhones.isNotEmpty()) {
            var expanded by remember { mutableStateOf(false) }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                Text("From: ", style = MaterialTheme.typography.bodyMedium)

                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = it }
                ) {
                    TextButton(
                        onClick = { expanded = true },
                        modifier = Modifier.menuAnchor()
                    ) {
                        Text(selectedPhone?.formattedPhoneNumber ?: "Select phone")
                        Icon(Icons.Default.ArrowDropDown, null)
                    }

                    ExposedDropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false }
                    ) {
                        verifiedPhones.forEach { phone ->
                            DropdownMenuItem(
                                text = { Text(phone.formattedPhoneNumber) },
                                onClick = {
                                    onPhoneSelect(phone)
                                    expanded = false
                                }
                            )
                        }
                    }
                }
            }
        }

        // Dial pad takes available space
        Box(
            modifier = Modifier.weight(1f),
            contentAlignment = Alignment.Center
        ) {
            DialPad(
                onDigitClick = onDigitClick,
                onDeleteClick = onDeleteClick
            )
        }

        // Call button - always at bottom
        FloatingActionButton(
            onClick = onCallClick,
            containerColor = if (hasVerifiedPhones) Color(0xFF4CAF50) else MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.size(72.dp)
        ) {
            Icon(
                Icons.Default.Phone,
                contentDescription = "Call",
                tint = Color.White,
                modifier = Modifier.size(32.dp)
            )
        }

        if (!hasVerifiedPhones) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Verify a phone number in Settings to make calls",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }

        Spacer(modifier = Modifier.height(8.dp))
    }
}

@Composable
private fun DialPad(
    onDigitClick: (String) -> Unit,
    onDeleteClick: () -> Unit
) {
    val digits = listOf(
        listOf("1" to "", "2" to "ABC", "3" to "DEF"),
        listOf("4" to "GHI", "5" to "JKL", "6" to "MNO"),
        listOf("7" to "PQRS", "8" to "TUV", "9" to "WXYZ"),
        listOf("*" to "", "0" to "+", "#" to "")
    )

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        digits.forEach { row ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                row.forEach { (digit, letters) ->
                    DialPadButton(
                        digit = digit,
                        letters = letters,
                        onClick = { onDigitClick(digit) }
                    )
                }
            }
        }

        // Last row with delete
        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Spacer(modifier = Modifier.size(72.dp))

            DialPadButton(
                digit = "+",
                letters = "",
                onClick = { if (true) onDigitClick("+") }
            )

            IconButton(
                onClick = onDeleteClick,
                modifier = Modifier.size(72.dp)
            ) {
                Icon(
                    Icons.Default.Backspace,
                    contentDescription = "Delete"
                )
            }
        }
    }
}

@Composable
private fun DialPadButton(
    digit: String,
    letters: String,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.size(72.dp),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceVariant
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = digit,
                style = MaterialTheme.typography.headlineMedium
            )
            if (letters.isNotEmpty()) {
                Text(
                    text = letters,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun NativeDialerContent(
    dialerNumber: String,
    hasVerifiedPhone: Boolean,
    onNumberChange: (String) -> Unit,
    onDigitClick: (String) -> Unit,
    onDeleteClick: () -> Unit,
    onCallClick: () -> Unit,
    onStartCall: () -> Unit,
    onVerifyPhoneClick: () -> Unit
) {

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Phone number display
        OutlinedTextField(
            value = dialerNumber,
            onValueChange = onNumberChange,
            modifier = Modifier.fillMaxWidth(),
            textStyle = LocalTextStyle.current.copy(
                fontSize = 28.sp,
                textAlign = TextAlign.Center
            ),
            placeholder = {
                Text(
                    "Enter phone number",
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Dial pad takes available space
        Box(
            modifier = Modifier.weight(1f),
            contentAlignment = Alignment.Center
        ) {
            DialPad(
                onDigitClick = onDigitClick,
                onDeleteClick = onDeleteClick
            )
        }

        // Single call button - all calls are recorded
        Column(
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            FloatingActionButton(
                onClick = {
                    if (hasVerifiedPhone) {
                        onStartCall()
                    } else {
                        onVerifyPhoneClick()
                    }
                },
                containerColor = if (hasVerifiedPhone) Color(0xFF4CAF50) else MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.size(72.dp)
            ) {
                Icon(
                    Icons.Default.Phone,
                    contentDescription = "Call",
                    tint = Color.White,
                    modifier = Modifier.size(32.dp)
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Call",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (!hasVerifiedPhone) {
                Text(
                    text = "Verify phone to call",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsContent(
    verifiedPhones: List<VerifiedPhone>,
    selectedPhone: VerifiedPhone?,
    verificationState: VerificationState,
    verificationPhoneNumber: String,
    verificationCode: String,
    verificationError: String?,
    onPhoneNumberChange: (String) -> Unit,
    onCodeChange: (String) -> Unit,
    onSendCode: () -> Unit,
    onVerify: () -> Unit,
    onReset: () -> Unit,
    onPhoneSelect: (VerifiedPhone) -> Unit,
    onPhoneDelete: (VerifiedPhone) -> Unit
) {
    var showVerificationDialog by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Add phone button
        item {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { showVerificationDialog = true }
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.AddCircle,
                        contentDescription = null,
                        tint = Color(0xFF4CAF50)
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text("Add Phone Number", fontWeight = FontWeight.Medium)
                }
            }
        }

        // Verified phones
        if (verifiedPhones.isNotEmpty()) {
            item {
                Text(
                    "Verified Numbers",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(top = 16.dp, bottom = 8.dp)
                )
            }

            items(verifiedPhones) { phone ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onPhoneSelect(phone) }
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = phone.formattedPhoneNumber,
                                fontWeight = FontWeight.Medium
                            )
                            phone.verifiedAt?.let {
                                Text(
                                    text = "Verified",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }

                        if (selectedPhone?.id == phone.id) {
                            Icon(
                                Icons.Default.CheckCircle,
                                contentDescription = "Selected",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }

                        IconButton(onClick = { onPhoneDelete(phone) }) {
                            Icon(
                                Icons.Default.Delete,
                                contentDescription = "Delete",
                                tint = Color.Red
                            )
                        }
                    }
                }
            }
        }

        // Info
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                )
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.Top
                ) {
                    Icon(
                        Icons.Default.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = "Phone calls are placed through your verified number. Recordings are transcribed and saved to your recordings.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }

    // Verification dialog
    if (showVerificationDialog) {
        AlertDialog(
            onDismissRequest = {
                showVerificationDialog = false
                onReset()
            },
            title = { Text("Verify Phone Number") },
            text = {
                Column {
                    when (verificationState) {
                        VerificationState.IDLE, VerificationState.SENDING_CODE -> {
                            Text("Enter your phone number to receive a verification code.")
                            Spacer(modifier = Modifier.height(16.dp))
                            OutlinedTextField(
                                value = verificationPhoneNumber,
                                onValueChange = onPhoneNumberChange,
                                label = { Text("Phone number") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                        VerificationState.CODE_SENT, VerificationState.VERIFYING -> {
                            Text("Enter the 6-digit code sent to $verificationPhoneNumber")
                            Spacer(modifier = Modifier.height(16.dp))
                            OutlinedTextField(
                                value = verificationCode,
                                onValueChange = onCodeChange,
                                label = { Text("Verification code") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                        VerificationState.VERIFIED -> {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(
                                    Icons.Default.CheckCircle,
                                    contentDescription = null,
                                    tint = Color(0xFF4CAF50),
                                    modifier = Modifier.size(48.dp)
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Text("Phone verified successfully!")
                            }
                        }
                        VerificationState.ERROR -> {
                            Text(
                                text = verificationError ?: "Verification failed",
                                color = Color.Red
                            )
                        }
                    }
                }
            },
            confirmButton = {
                when (verificationState) {
                    VerificationState.IDLE -> {
                        Button(
                            onClick = onSendCode,
                            enabled = verificationPhoneNumber.isNotBlank()
                        ) {
                            Text("Send Code")
                        }
                    }
                    VerificationState.SENDING_CODE -> {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    }
                    VerificationState.CODE_SENT -> {
                        Button(
                            onClick = onVerify,
                            enabled = verificationCode.length == 6
                        ) {
                            Text("Verify")
                        }
                    }
                    VerificationState.VERIFYING -> {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    }
                    VerificationState.VERIFIED -> {
                        Button(onClick = {
                            showVerificationDialog = false
                            onReset()
                        }) {
                            Text("Done")
                        }
                    }
                    VerificationState.ERROR -> {
                        Button(onClick = onReset) {
                            Text("Try Again")
                        }
                    }
                }
            },
            dismissButton = {
                if (verificationState != VerificationState.VERIFIED) {
                    TextButton(onClick = {
                        showVerificationDialog = false
                        onReset()
                    }) {
                        Text("Cancel")
                    }
                }
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActiveCallSheet(
    call: PhoneCall?,
    callState: ActiveCallState,
    isMuted: Boolean,
    isSpeakerOn: Boolean,
    onToggleMute: () -> Unit,
    onToggleSpeaker: () -> Unit,
    onHangup: () -> Unit,
    onDismiss: () -> Unit
) {
    if (call == null) return

    // Determine if call is still active (not ended/failed)
    val isCallActive = callState in listOf(
        ActiveCallState.INITIATING,
        ActiveCallState.RINGING,
        ActiveCallState.CONNECTED,
        ActiveCallState.RECORDING
    )

    // Create sheet state with skip partially expanded for better UX
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { sheetValue ->
            // Prevent dismissing by swipe/outside click when call is active
            if (isCallActive) {
                sheetValue != SheetValue.Hidden
            } else {
                true
            }
        }
    )

    ModalBottomSheet(
        onDismissRequest = {
            // Only allow dismiss if call is not active
            if (!isCallActive) {
                onDismiss()
            }
        },
        sheetState = sheetState,
        // Hide drag handle during active call to discourage swiping
        dragHandle = if (isCallActive) {
            { /* No drag handle during active call */ }
        } else null
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Recording indicator - always show when connected (auto-recording)
            if (callState == ActiveCallState.CONNECTED || callState == ActiveCallState.RECORDING) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(bottom = 16.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .clip(CircleShape)
                            .background(Color.Red)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        "Recording",
                        color = Color.Red,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            // Status with appropriate color for different states
            val statusText = when (callState) {
                ActiveCallState.INITIATING -> "Connecting..."
                ActiveCallState.RINGING -> "Ringing..."
                ActiveCallState.CONNECTED, ActiveCallState.RECORDING -> "Connected - Recording"
                ActiveCallState.ENDED -> "Call Ended"
                ActiveCallState.DECLINED -> "Call Declined"
                ActiveCallState.BUSY -> "Line Busy"
                ActiveCallState.NO_ANSWER -> "No Answer"
                ActiveCallState.ERROR -> "Call Failed"
                else -> ""
            }

            val statusColor = when (callState) {
                ActiveCallState.DECLINED, ActiveCallState.BUSY, ActiveCallState.NO_ANSWER, ActiveCallState.ERROR ->
                    MaterialTheme.colorScheme.error
                ActiveCallState.ENDED -> MaterialTheme.colorScheme.onSurfaceVariant
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            }

            Text(
                text = statusText,
                style = MaterialTheme.typography.bodyMedium,
                color = statusColor,
                fontWeight = if (callState in listOf(ActiveCallState.DECLINED, ActiveCallState.BUSY, ActiveCallState.NO_ANSWER, ActiveCallState.ERROR))
                    FontWeight.Bold else FontWeight.Normal
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Avatar
            Box(
                modifier = Modifier
                    .size(100.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.size(50.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Name/number
            Text(
                text = call.toName ?: call.formattedToNumber,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )

            if (call.toName != null) {
                Text(
                    text = call.formattedToNumber,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.height(32.dp))

            // Call controls row - Mute, Hangup, Speaker
            Row(
                horizontalArrangement = Arrangement.spacedBy(24.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Mute button
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    FloatingActionButton(
                        onClick = onToggleMute,
                        containerColor = if (isMuted) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.size(56.dp)
                    ) {
                        Icon(
                            if (isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                            contentDescription = if (isMuted) "Unmute" else "Mute",
                            modifier = Modifier.size(24.dp),
                            tint = if (isMuted) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        if (isMuted) "Unmute" else "Mute",
                        style = MaterialTheme.typography.labelSmall
                    )
                }

                // Hangup button
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    FloatingActionButton(
                        onClick = onHangup,
                        containerColor = Color.Red,
                        modifier = Modifier.size(72.dp)
                    ) {
                        Icon(
                            Icons.Default.CallEnd,
                            contentDescription = "End Call",
                            modifier = Modifier.size(32.dp),
                            tint = Color.White
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("End Call", style = MaterialTheme.typography.labelSmall)
                }

                // Speaker button
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    FloatingActionButton(
                        onClick = onToggleSpeaker,
                        containerColor = if (isSpeakerOn) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.size(56.dp)
                    ) {
                        Icon(
                            if (isSpeakerOn) Icons.Default.VolumeUp else Icons.Default.VolumeDown,
                            contentDescription = if (isSpeakerOn) "Speaker Off" else "Speaker On",
                            modifier = Modifier.size(24.dp),
                            tint = if (isSpeakerOn) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        if (isSpeakerOn) "Speaker" else "Speaker",
                        style = MaterialTheme.typography.labelSmall
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

private fun formatCallDate(dateString: String): String {
    return try {
        val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        val date = parser.parse(dateString) ?: return dateString

        val now = Calendar.getInstance()
        val callDate = Calendar.getInstance().apply { time = date }

        val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
        val dateFormat = SimpleDateFormat("MMM d", Locale.getDefault())

        when {
            now.get(Calendar.DAY_OF_YEAR) == callDate.get(Calendar.DAY_OF_YEAR) &&
            now.get(Calendar.YEAR) == callDate.get(Calendar.YEAR) -> {
                "Today ${timeFormat.format(date)}"
            }
            now.get(Calendar.DAY_OF_YEAR) - 1 == callDate.get(Calendar.DAY_OF_YEAR) &&
            now.get(Calendar.YEAR) == callDate.get(Calendar.YEAR) -> {
                "Yesterday ${timeFormat.format(date)}"
            }
            else -> {
                "${dateFormat.format(date)} ${timeFormat.format(date)}"
            }
        }
    } catch (e: Exception) {
        dateString
    }
}

@Composable
private fun NoVerifiedPhoneContent(
    modifier: Modifier = Modifier,
    onVerifyClick: () -> Unit
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Icon with gradient-like background
        Box(
            modifier = Modifier
                .size(100.dp)
                .clip(CircleShape)
                .background(
                    brush = androidx.compose.ui.graphics.Brush.linearGradient(
                        colors = listOf(Color(0xFF2196F3), Color(0xFF4CAF50))
                    )
                ),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Default.PhoneEnabled,
                contentDescription = null,
                modifier = Modifier.size(50.dp),
                tint = Color.White
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Verify Your Phone",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold
        )

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = "To make calls through the app, you need to verify your phone number first. We'll call you with a verification code.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 16.dp)
        )

        Spacer(modifier = Modifier.height(32.dp))

        Button(
            onClick = onVerifyClick,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(
                Icons.Default.Phone,
                contentDescription = null,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                "Verify Phone Number",
                style = MaterialTheme.typography.titleMedium
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VerificationBottomSheet(
    verificationState: VerificationState,
    verificationPhoneNumber: String,
    verificationCode: String,
    verificationError: String?,
    onPhoneNumberChange: (String) -> Unit,
    onCodeChange: (String) -> Unit,
    onSendCode: () -> Unit,
    onVerify: () -> Unit,
    onReset: () -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Verify Phone Number",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )

            Spacer(modifier = Modifier.height(24.dp))

            when (verificationState) {
                VerificationState.IDLE, VerificationState.SENDING_CODE -> {
                    Text(
                        text = "Enter your phone number. We'll call you with a verification code.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    OutlinedTextField(
                        value = verificationPhoneNumber,
                        onValueChange = onPhoneNumberChange,
                        label = { Text("Phone number") },
                        placeholder = { Text("+1 (555) 123-4567") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    Button(
                        onClick = onSendCode,
                        enabled = verificationPhoneNumber.isNotBlank() && verificationState != VerificationState.SENDING_CODE,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        if (verificationState == VerificationState.SENDING_CODE) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                color = Color.White
                            )
                        } else {
                            Text("Call Me with Code")
                        }
                    }
                }

                VerificationState.CODE_SENT, VerificationState.VERIFYING -> {
                    Text(
                        text = "Answer your phone! Enter the 6-digit code you hear.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = verificationPhoneNumber,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    OutlinedTextField(
                        value = verificationCode,
                        onValueChange = { if (it.length <= 6) onCodeChange(it) },
                        label = { Text("Verification code") },
                        placeholder = { Text("123456") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        textStyle = LocalTextStyle.current.copy(
                            fontSize = 24.sp,
                            textAlign = TextAlign.Center,
                            letterSpacing = 8.sp
                        )
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    Button(
                        onClick = onVerify,
                        enabled = verificationCode.length == 6 && verificationState != VerificationState.VERIFYING,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        if (verificationState == VerificationState.VERIFYING) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                color = Color.White
                            )
                        } else {
                            Text("Verify")
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    TextButton(onClick = onReset) {
                        Text("Request New Code")
                    }
                }

                VerificationState.VERIFIED -> {
                    Icon(
                        Icons.Default.CheckCircle,
                        contentDescription = null,
                        tint = Color(0xFF4CAF50),
                        modifier = Modifier.size(64.dp)
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    Text(
                        text = "Phone Verified!",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF4CAF50)
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = "You can now make calls through the app.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    Button(
                        onClick = onDismiss,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Done")
                    }
                }

                VerificationState.ERROR -> {
                    Icon(
                        Icons.Default.Error,
                        contentDescription = null,
                        tint = Color.Red,
                        modifier = Modifier.size(64.dp)
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    Text(
                        text = "Verification Failed",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        color = Color.Red
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = verificationError ?: "Something went wrong. Please try again.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    Button(
                        onClick = onReset,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Try Again")
                    }
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}
