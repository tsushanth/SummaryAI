package com.kreativekoala.summaryai.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.os.LocaleListCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.ui.graphics.Color
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.preferences.ThemeMode
import com.kreativekoala.summaryai.domain.model.User
import com.kreativekoala.paywallkit.models.PaywallFeature
import com.kreativekoala.paywallkit.models.PaywallTheme
import com.kreativekoala.paywallkit.view.PaywallPreview

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel = hiltViewModel(),
    onCalendarClick: () -> Unit,
    onUpgradeClick: () -> Unit,
    onSignOut: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    var showSignOutDialog by remember { mutableStateOf(false) }
    var showDeleteAccountDialog by remember { mutableStateOf(false) }
    var showLanguageDialog by remember { mutableStateOf(false) }
    var tapCount by remember { mutableIntStateOf(0) }
    var showPaywallPreview by remember { mutableStateOf(false) }

    val languages = remember {
        listOf(
            "en" to R.string.language_english,
            "es" to R.string.language_spanish,
            "fr" to R.string.language_french,
            "de" to R.string.language_german,
            "ja" to R.string.language_japanese,
            "zh-CN" to R.string.language_chinese,
            "ko" to R.string.language_korean,
            "pt-BR" to R.string.language_portuguese,
            "it" to R.string.language_italian,
            "hi" to R.string.language_hindi
        )
    }
    val currentLocaleTag = AppCompatDelegate.getApplicationLocales().toLanguageTags().ifEmpty { "en" }
    val currentLanguageRes = languages.firstOrNull { it.first == currentLocaleTag }?.second ?: R.string.language_english

    LaunchedEffect(uiState.signedOut) {
        if (uiState.signedOut) {
            onSignOut()
        }
    }

    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    if (showPaywallPreview) {
        PaywallPreview(
            appId = "meetingmind",
            appName = "MeetingMind",
            features = listOf(
                PaywallFeature("\uD83C\uDFA4", "Unlimited Recordings"),
                PaywallFeature("\uD83D\uDCDD", "AI Summaries"),
                PaywallFeature("\uD83D\uDD0D", "Smart Search"),
                PaywallFeature("\uD83D\uDCE4", "Export"),
                PaywallFeature("☁\uFE0F", "Cloud Storage")
            ),
            theme = PaywallTheme(accent = Color(0xFF6C63FF), accent2 = Color(0xFF9C27B0)),
            onDone = { showPaywallPreview = false }
        )
        return
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings)) }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
        ) {
            // Account Section
            uiState.user?.let { user ->
                SettingsSection(title = stringResource(R.string.account)) {
                    AccountCard(user = user, onUpgradeClick = onUpgradeClick)
                }
            }

            // Appearance Section
            SettingsSection(title = stringResource(R.string.appearance)) {
                ThemeSelector(
                    currentMode = uiState.themeMode,
                    onModeSelected = viewModel::setThemeMode
                )
            }

            // Language Section
            SettingsSection(title = stringResource(R.string.language)) {
                SettingsItem(
                    icon = Icons.Default.Language,
                    title = stringResource(R.string.language),
                    subtitle = stringResource(currentLanguageRes),
                    onClick = { showLanguageDialog = true }
                )
            }

            // Integrations Section
            SettingsSection(title = stringResource(R.string.integrations)) {
                SettingsItem(
                    icon = Icons.Default.CalendarMonth,
                    title = stringResource(R.string.connect_calendar),
                    subtitle = if (uiState.hasCalendarConnected) stringResource(R.string.connected) else stringResource(R.string.calendar_sync_subtitle),
                    onClick = onCalendarClick
                )
            }

            // Legal Section
            SettingsSection(title = stringResource(R.string.legal)) {
                SettingsItem(
                    icon = Icons.Default.PrivacyTip,
                    title = stringResource(R.string.privacy_policy),
                    onClick = {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://kreativekoala.llc/privacy"))
                        context.startActivity(intent)
                    },
                    trailing = { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp)) }
                )
                HorizontalDivider(modifier = Modifier.padding(start = 56.dp))
                SettingsItem(
                    icon = Icons.Default.Description,
                    title = stringResource(R.string.terms_of_service),
                    onClick = {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://kreativekoala.llc/terms"))
                        context.startActivity(intent)
                    },
                    trailing = { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp)) }
                )
            }

            // About Section
            SettingsSection(title = stringResource(R.string.about)) {
                SettingsItem(
                    icon = Icons.Default.Info,
                    title = stringResource(R.string.version),
                    subtitle = uiState.appVersion,
                    onClick = { tapCount++ }
                )
                if (tapCount >= 5) {
                    Button(
                        onClick = { showPaywallPreview = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp)
                    ) {
                        Text("Preview Paywalls")
                    }
                }
                HorizontalDivider(modifier = Modifier.padding(start = 56.dp))
                SettingsItem(
                    icon = Icons.Default.Build,
                    title = stringResource(R.string.build),
                    subtitle = uiState.buildNumber
                )
                HorizontalDivider(modifier = Modifier.padding(start = 56.dp))
                SettingsItem(
                    icon = Icons.Default.HelpOutline,
                    title = stringResource(R.string.help_faq),
                    onClick = {
                        // TODO: Open FAQ screen
                    }
                )
                HorizontalDivider(modifier = Modifier.padding(start = 56.dp))
                SettingsItem(
                    icon = Icons.Default.Email,
                    title = stringResource(R.string.contact_us),
                    onClick = {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://kreativekoala.llc/contact"))
                        context.startActivity(intent)
                    },
                    trailing = { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp)) }
                )
            }

            // Sign Out Section
            Spacer(modifier = Modifier.height(16.dp))

            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                Button(
                    onClick = { showSignOutDialog = true },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                        contentColor = MaterialTheme.colorScheme.onErrorContainer
                    )
                ) {
                    Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(R.string.sign_out))
                }

                Spacer(modifier = Modifier.height(8.dp))

                TextButton(
                    onClick = { showDeleteAccountDialog = true },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        stringResource(R.string.delete_account),
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }

        // Sign Out Dialog
        if (showSignOutDialog) {
            AlertDialog(
                onDismissRequest = { showSignOutDialog = false },
                title = { Text(stringResource(R.string.sign_out)) },
                text = { Text(stringResource(R.string.sign_out_confirm)) },
                confirmButton = {
                    TextButton(
                        onClick = {
                            showSignOutDialog = false
                            viewModel.signOut()
                        }
                    ) {
                        Text(stringResource(R.string.sign_out))
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showSignOutDialog = false }) {
                        Text(stringResource(R.string.cancel))
                    }
                }
            )
        }

        // Language Dialog
        if (showLanguageDialog) {
            AlertDialog(
                onDismissRequest = { showLanguageDialog = false },
                title = { Text(stringResource(R.string.language_picker_title)) },
                text = {
                    Column {
                        languages.forEach { (code, nameRes) ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                RadioButton(
                                    selected = currentLocaleTag == code || (currentLocaleTag == "en" && code == "en"),
                                    onClick = {
                                        AppCompatDelegate.setApplicationLocales(
                                            LocaleListCompat.forLanguageTags(code)
                                        )
                                        showLanguageDialog = false
                                    }
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = stringResource(nameRes),
                                    style = MaterialTheme.typography.bodyLarge
                                )
                            }
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = { showLanguageDialog = false }) {
                        Text(stringResource(R.string.cancel))
                    }
                }
            )
        }

        // Delete Account Dialog
        if (showDeleteAccountDialog) {
            AlertDialog(
                onDismissRequest = { showDeleteAccountDialog = false },
                title = { Text(stringResource(R.string.delete_account)) },
                text = { Text(stringResource(R.string.delete_account_warning)) },
                confirmButton = {
                    TextButton(
                        onClick = {
                            showDeleteAccountDialog = false
                            viewModel.deleteAccount()
                        },
                        enabled = !uiState.isDeleting
                    ) {
                        Text(stringResource(R.string.delete_account), color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showDeleteAccountDialog = false }) {
                        Text(stringResource(R.string.cancel))
                    }
                }
            )
        }
    }
}

@Composable
private fun SettingsSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(modifier = Modifier.padding(vertical = 8.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        )
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
        ) {
            Column(content = content)
        }
    }
}

@Composable
private fun SettingsItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String? = null,
    onClick: (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = null
) {
    Surface(
        onClick = onClick ?: {},
        enabled = onClick != null
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyLarge
                )
                subtitle?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            trailing?.invoke()
        }
    }
}

@Composable
private fun AccountCard(user: User, onUpgradeClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Avatar
        Surface(
            modifier = Modifier.size(50.dp),
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.primaryContainer
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    text = user.initials,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            user.fullName?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.titleMedium
                )
            }
            Text(
                text = user.email,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = stringResource(R.string.via_provider, user.provider.displayName),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        if (!user.isPro) {
            FilledTonalButton(onClick = onUpgradeClick) {
                Text(stringResource(R.string.pro))
            }
        } else {
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = MaterialTheme.shapes.small
            ) {
                Text(
                    text = stringResource(R.string.pro),
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }
    }
}

@Composable
private fun ThemeSelector(
    currentMode: ThemeMode,
    onModeSelected: (ThemeMode) -> Unit
) {
    Column {
        ThemeOption(
            icon = Icons.Default.LightMode,
            title = stringResource(R.string.theme_light),
            subtitle = stringResource(R.string.theme_light_subtitle),
            isSelected = currentMode == ThemeMode.LIGHT,
            onClick = { onModeSelected(ThemeMode.LIGHT) }
        )
        HorizontalDivider(modifier = Modifier.padding(start = 56.dp))
        ThemeOption(
            icon = Icons.Default.DarkMode,
            title = stringResource(R.string.theme_dark),
            subtitle = stringResource(R.string.theme_dark_subtitle),
            isSelected = currentMode == ThemeMode.DARK,
            onClick = { onModeSelected(ThemeMode.DARK) }
        )
        HorizontalDivider(modifier = Modifier.padding(start = 56.dp))
        ThemeOption(
            icon = Icons.Default.SettingsBrightness,
            title = stringResource(R.string.theme_system),
            subtitle = stringResource(R.string.theme_system_subtitle),
            isSelected = currentMode == ThemeMode.SYSTEM,
            onClick = { onModeSelected(ThemeMode.SYSTEM) }
        )
    }
}

@Composable
private fun ThemeOption(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Surface(onClick = onClick) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (isSelected) {
                Icon(
                    imageVector = Icons.Default.Check,
                    contentDescription = stringResource(R.string.selected),
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}
