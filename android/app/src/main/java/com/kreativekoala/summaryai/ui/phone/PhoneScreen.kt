package com.kreativekoala.summaryai.ui.phone

import android.Manifest
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.domain.model.VerifiedPhone

@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun PhoneScreen(
    viewModel: PhoneViewModel = hiltViewModel(),
    onRecordingClick: (String) -> Unit = {},
    numberViewModel: OwnNumberViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val number by numberViewModel.uiState.collectAsState()
    val isMuted by viewModel.isMuted.collectAsState()
    val isSpeakerOn by viewModel.isSpeakerOn.collectAsState()

    // The calling SDK needs the microphone; asked for only after the recording consent.
    var acceptedWaitingForMic by remember { mutableStateOf(false) }
    val micPermission = rememberPermissionState(Manifest.permission.RECORD_AUDIO) { granted ->
        if (acceptedWaitingForMic) {
            acceptedWaitingForMic = false
            if (granted) viewModel.acceptConsent() else viewModel.microphoneRefused()
        }
    }

    val snackbarHostState = remember { SnackbarHostState() }
    val messageText = state.message?.let { phoneMessageText(it) }
    LaunchedEffect(messageText) {
        if (messageText != null) {
            snackbarHostState.showSnackbar(messageText)
            viewModel.clearMessage()
        }
    }

    var removing by remember { mutableStateOf<VerifiedPhone?>(null) }

    // The own number is loaded when the server shows it, and again whenever the verified numbers change.
    LaunchedEffect(state.ownNumberAvailable, state.phones.size) {
        if (state.ownNumberAvailable) numberViewModel.refresh()
    }
    val ownNumber = usableNumber(number.plan)
    LaunchedEffect(ownNumber) {
        viewModel.setOwnNumber(ownNumber?.let { VerifiedPhone(it.id, it.phoneNumber) })
    }
    LaunchedEffect(number.agentsSaved) {
        if (number.agentsSaved > 0) viewModel.askBusinessForAgent()
    }
    val numberMessage = number.message?.let { phoneMessageText(it) }
    LaunchedEffect(numberMessage) {
        if (numberMessage != null) {
            snackbarHostState.showSnackbar(numberMessage)
            numberViewModel.clearMessage()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(stringResource(R.string.phone), style = MaterialTheme.typography.headlineMedium) }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            TabRow(selectedTabIndex = state.tab.ordinal, modifier = Modifier.fillMaxWidth()) {
                Tab(
                    selected = state.tab == PhoneTab.DIALER,
                    onClick = { viewModel.selectTab(PhoneTab.DIALER) },
                    text = { Text(stringResource(R.string.dialer)) }
                )
                Tab(
                    selected = state.tab == PhoneTab.CALLS,
                    onClick = { viewModel.selectTab(PhoneTab.CALLS) },
                    text = { Text(stringResource(R.string.calls)) }
                )
                if (state.ownNumberAvailable) {
                    Tab(
                        selected = state.tab == PhoneTab.NUMBER,
                        onClick = {
                            viewModel.selectTab(PhoneTab.NUMBER)
                            numberViewModel.opened()
                        },
                        text = { Text(stringResource(R.string.phone_tab_my_number), maxLines = 1) }
                    )
                }
            }
            if (state.isLoading) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            when (state.tab) {
                PhoneTab.DIALER -> DialerContent(
                    state = state,
                    onNumberChange = viewModel::setDialerNumber,
                    onNameChange = viewModel::setDialerName,
                    onDigit = viewModel::appendDigit,
                    onDelete = viewModel::deleteDigit,
                    onLanguage = viewModel::setCallLanguage,
                    onCall = { viewModel.requestCall() },
                    header = {
                        if (!state.isLoading) {
                            PhoneHeader(
                                state = state,
                                onVerify = viewModel::openVerification,
                                onSelect = viewModel::selectPhone,
                                onRemove = { removing = it }
                            )
                        }
                    }
                )
                PhoneTab.CALLS -> CallsContent(
                    calls = state.calls,
                    isLoading = state.isLoading,
                    onRecordingClick = onRecordingClick,
                    onCallClick = viewModel::callFromHistory,
                    onDetails = viewModel::openCall
                )
                PhoneTab.NUMBER -> OwnNumberContent(
                    state = number,
                    hasVerifiedPhone = state.phones.isNotEmpty(),
                    actions = numberViewModel,
                    onVerify = viewModel::openVerification
                )
            }
        }
    }

    if (state.verification != Verification.Hidden && !state.askBusiness) {
        VerificationBottomSheet(
            state = state.verification,
            onStart = viewModel::startVerification,
            onRetry = viewModel::openVerification,
            onDismiss = viewModel::closeVerification
        )
    }
    if (state.askBusiness) {
        BusinessQuestionSheet(onAnswer = viewModel::answerBusiness)
    }
    state.consent?.let { consent ->
        RecordingConsentDialog(
            consent = consent,
            onAccept = {
                if (micPermission.status.isGranted) {
                    viewModel.acceptConsent()
                } else {
                    acceptedWaitingForMic = true
                    micPermission.launchPermissionRequest()
                }
            },
            onDecline = viewModel::declineConsent
        )
    }
    removing?.let { phone ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text(stringResource(R.string.phone_remove_number_title)) },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(phone.formattedPhoneNumber); Text(stringResource(R.string.phone_remove_number_message)) } },
            confirmButton = {
                TextButton(onClick = { viewModel.removePhone(phone); removing = null }) { Text(stringResource(R.string.phone_remove)) }
            },
            dismissButton = { TextButton(onClick = { removing = null }) { Text(stringResource(R.string.cancel)) } }
        )
    }
    state.openCall?.let { call ->
        CallResultSheet(
            call = call,
            onRecordingClick = { id -> viewModel.closeCall(); onRecordingClick(id) },
            onCallBack = { viewModel.callFromHistory(call) },
            onDismiss = viewModel::closeCall
        )
    }
    state.activeCall?.let { active ->
        ActiveCallSheet(
            active = active,
            isMuted = isMuted,
            isSpeakerOn = isSpeakerOn,
            onToggleMute = viewModel::toggleMute,
            onToggleSpeaker = viewModel::toggleSpeaker,
            onHangup = viewModel::hangUp
        )
    }
}
