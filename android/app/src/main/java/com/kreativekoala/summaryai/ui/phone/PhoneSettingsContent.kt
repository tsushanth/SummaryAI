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
