package com.kreativekoala.summaryai.ui.phone

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.domain.model.VerifiedPhone
import com.kreativekoala.summaryai.ui.components.MmCard
import com.kreativekoala.summaryai.ui.components.MmSectionHeader
import java.util.*


@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SettingsContent(
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
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Add phone button
        item {
            MmCard(onClick = { showVerificationDialog = true }) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.AddCircle,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text("Add Phone Number", fontWeight = FontWeight.Medium)
                }
            }
        }

        // Verified phones
        if (verifiedPhones.isNotEmpty()) {
            item {
                MmSectionHeader(
                    title = "Verified Numbers",
                    modifier = Modifier.padding(top = 12.dp)
                )
            }

            items(verifiedPhones) { phone ->
                MmCard(onClick = { onPhoneSelect(phone) }) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
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
                                tint = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }
            }
        }

        // Info
        item {
            MmCard(containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
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
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(48.dp)
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Text("Phone verified successfully!")
                            }
                        }
                        VerificationState.ERROR -> {
                            Text(
                                text = verificationError ?: "Verification failed",
                                color = MaterialTheme.colorScheme.error
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
