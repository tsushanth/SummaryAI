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


@Composable
internal fun NoVerifiedPhoneContent(
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
internal fun VerificationBottomSheet(
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
