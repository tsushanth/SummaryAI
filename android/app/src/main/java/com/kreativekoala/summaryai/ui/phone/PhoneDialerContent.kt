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
internal fun DialerContent(
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
internal fun DialPad(
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
internal fun DialPadButton(
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
internal fun NativeDialerContent(
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
