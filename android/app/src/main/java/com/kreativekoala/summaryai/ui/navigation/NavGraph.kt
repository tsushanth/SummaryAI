package com.kreativekoala.summaryai.ui.navigation

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.VideoCall
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.VideoCall
import androidx.compose.material3.Icon
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.R
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument

import com.kreativekoala.summaryai.ui.auth.AuthScreen
import com.kreativekoala.summaryai.ui.calendar.CalendarIntegrationScreen
import com.kreativekoala.summaryai.ui.meetings.JoinMeetingScreen
import com.kreativekoala.summaryai.ui.meetings.MeetingsScreen
import com.kreativekoala.summaryai.ui.onboarding.OnboardingScreen
import com.kreativekoala.summaryai.ui.paywall.PaywallScreen
import com.kreativekoala.summaryai.ui.phone.PhoneScreen
import com.kreativekoala.summaryai.ui.recording.RecordingScreen
import com.kreativekoala.summaryai.ui.livecaption.LiveCaptionScreen
import com.kreativekoala.summaryai.ui.recordings.RecordingDetailScreen
import com.kreativekoala.summaryai.ui.recordings.RecordingsListScreen
import com.kreativekoala.summaryai.ui.search.SearchScreen
import com.kreativekoala.summaryai.ui.settings.SettingsScreen
import com.kreativekoala.summaryai.ui.todos.TodosScreen

// CompositionLocal to communicate tab re-selection for scroll-to-top behavior
val LocalTabReselection = compositionLocalOf { TabReselectionState() }

class TabReselectionState {
    private val _reselectionCounter = mutableIntStateOf(0)
    val reselectionCounter: Int get() = _reselectionCounter.intValue

    fun onTabReselected() {
        _reselectionCounter.intValue++
    }
}

// Navigation routes
sealed class Screen(val route: String) {
    object Auth : Screen("auth")
    object Onboarding : Screen("onboarding")
    object Recordings : Screen("recordings")
    object RecordingDetail : Screen("recordings/{recordingId}") {
        fun createRoute(recordingId: String) = "recordings/$recordingId"
    }
    object Recording : Screen("recording")
    object LiveCaption : Screen("live_caption")
    object Todos : Screen("todos")
    object Meetings : Screen("meetings")
    object JoinMeeting : Screen("meetings/join")
    object CalendarIntegration : Screen("calendar")
    object Search : Screen("search")
    object Phone : Screen("phone")
    object Settings : Screen("settings")
    object Paywall : Screen("paywall")
    object HardPaywall : Screen("paywall/hard")
}

// Bottom navigation items
sealed class NavIcon {
    data class Vector(val selected: ImageVector, val unselected: ImageVector) : NavIcon()
    data class Resource(val resId: Int) : NavIcon()
}

data class BottomNavItem(
    val screen: Screen,
    @StringRes val titleRes: Int,
    val icon: NavIcon
)

val bottomNavItems = listOf(
    BottomNavItem(
        screen = Screen.Recordings,
        titleRes = R.string.recordings,
        icon = NavIcon.Resource(R.drawable.ic_recordings)
    ),
    BottomNavItem(
        screen = Screen.Meetings,
        titleRes = R.string.calendar,
        icon = NavIcon.Vector(Icons.Filled.CalendarMonth, Icons.Outlined.CalendarMonth)
    ),
    BottomNavItem(
        screen = Screen.Recording,
        titleRes = R.string.record,
        icon = NavIcon.Vector(Icons.Filled.Mic, Icons.Outlined.Mic)
    ),
    BottomNavItem(
        screen = Screen.Phone,
        titleRes = R.string.phone,
        icon = NavIcon.Vector(Icons.Filled.Phone, Icons.Outlined.Phone)
    ),
    BottomNavItem(
        screen = Screen.Settings,
        titleRes = R.string.settings,
        icon = NavIcon.Resource(R.drawable.ic_settings)
    )
)

@Composable
fun MeetingMindNavGraph(
    isAuthenticated: Boolean,
    hasCompletedOnboarding: Boolean,
    showPaywall: Boolean = false,
    // Live check — called at every gated action (start recording, join meeting,
    // place call) so the gate is re-evaluated, not captured at composition.
    shouldHardGate: () -> Boolean = { false },
    navController: NavHostController = rememberNavController()
) {
    // Helper for routing gated actions. Mutating navController inline reads
    // cleaner at call sites and keeps the hard-gate logic centralized.
    val navigateGated: (String) -> Unit = { targetRoute ->
        if (shouldHardGate()) {
            navController.navigate(Screen.HardPaywall.route)
        } else {
            navController.navigate(targetRoute)
        }
    }
    // Only compute startDestination once on initial composition.
    // Subsequent state changes are handled by the LaunchedEffect below.
    val startDestination = remember {
        when {
            !isAuthenticated -> Screen.Auth.route
            !hasCompletedOnboarding -> Screen.Onboarding.route
            else -> Screen.Recordings.route
        }
    }

    // Navigate to paywall when triggered from MainActivity (open count gate)
    LaunchedEffect(showPaywall, isAuthenticated, hasCompletedOnboarding) {
        if (showPaywall && isAuthenticated && hasCompletedOnboarding) {
            navController.navigate(Screen.Paywall.route) {
                launchSingleTop = true
            }
        }
    }

    // Navigate when auth state changes - must handle transition from unauthenticated to authenticated
    LaunchedEffect(isAuthenticated, hasCompletedOnboarding) {
        val targetRoute = when {
            !isAuthenticated -> Screen.Auth.route
            !hasCompletedOnboarding -> Screen.Onboarding.route
            else -> Screen.Recordings.route
        }
        val currentRoute = navController.currentDestination?.route

        android.util.Log.i("NavGraph", "Auth state changed: isAuth=$isAuthenticated, hasOnboarding=$hasCompletedOnboarding, currentRoute=$currentRoute, targetRoute=$targetRoute")

        // If authenticated and should be on recordings, navigate there from auth or onboarding
        if (isAuthenticated && hasCompletedOnboarding) {
            if (currentRoute == Screen.Auth.route) {
                android.util.Log.i("NavGraph", "Navigating from auth to recordings")
                navController.navigate(Screen.Recordings.route) {
                    popUpTo(Screen.Auth.route) { inclusive = true }
                }
            } else if (currentRoute == Screen.Onboarding.route) {
                android.util.Log.i("NavGraph", "Navigating from onboarding to recordings")
                navController.navigate(Screen.Recordings.route) {
                    popUpTo(Screen.Onboarding.route) { inclusive = true }
                }
            }
        }
        // If not authenticated, navigate to auth
        else if (!isAuthenticated && currentRoute != Screen.Auth.route && currentRoute != null) {
            android.util.Log.i("NavGraph", "Navigating to auth (not authenticated)")
            navController.navigate(Screen.Auth.route) {
                popUpTo(0) { inclusive = true }
            }
        }
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    // State for handling tab re-selection (scroll-to-top behavior)
    val tabReselectionState = remember { TabReselectionState() }

    // Determine if we should show bottom nav
    val showBottomNav = isAuthenticated && hasCompletedOnboarding &&
            currentDestination?.route in listOf(
        Screen.Recordings.route,
        Screen.Meetings.route,
        Screen.Recording.route,
        Screen.Phone.route,
        Screen.Settings.route
    )

    CompositionLocalProvider(LocalTabReselection provides tabReselectionState) {
        Scaffold(
            bottomBar = {
                if (showBottomNav) {
                    NavigationBar {
                        bottomNavItems.forEach { item ->
                            val selected = currentDestination?.hierarchy?.any {
                                it.route == item.screen.route
                            } == true

                            NavigationBarItem(
                                selected = selected,
                                onClick = {
                                    if (selected) {
                                        // Tab is already selected - trigger scroll-to-top
                                        tabReselectionState.onTabReselected()
                                    } else {
                                        // Gate Recording + Phone tabs at the action level —
                                        // if the user has exhausted free opens AND is not
                                        // subscribed, route them to the hard paywall instead.
                                        val isGatedAction = item.screen.route == Screen.Recording.route ||
                                                item.screen.route == Screen.Phone.route
                                        if (isGatedAction && shouldHardGate()) {
                                            navController.navigate(Screen.HardPaywall.route) {
                                                launchSingleTop = true
                                            }
                                        } else {
                                            navController.navigate(item.screen.route) {
                                                popUpTo(navController.graph.findStartDestination().id) {
                                                    saveState = true
                                                }
                                                launchSingleTop = true
                                                restoreState = true
                                            }
                                        }
                                    }
                                },
                                icon = {
                                    val title = stringResource(item.titleRes)
                                    when (val icon = item.icon) {
                                        is NavIcon.Vector -> Icon(
                                            imageVector = if (selected) icon.selected else icon.unselected,
                                            contentDescription = title
                                        )
                                        is NavIcon.Resource -> Icon(
                                            painter = painterResource(id = icon.resId),
                                            contentDescription = title,
                                            modifier = Modifier.size(24.dp)
                                        )
                                    }
                                },
                                label = { Text(stringResource(item.titleRes)) }
                            )
                        }
                    }
                }
            }
        ) { paddingValues ->
        NavHost(
            navController = navController,
            startDestination = startDestination,
            modifier = Modifier.padding(paddingValues)
        ) {
            // Auth
            composable(Screen.Auth.route) {
                AuthScreen(
                    onAuthSuccess = {
                        navController.navigate(
                            if (hasCompletedOnboarding) Screen.Recordings.route else Screen.Onboarding.route
                        ) {
                            popUpTo(Screen.Auth.route) { inclusive = true }
                        }
                    }
                )
            }

            // Onboarding
            composable(Screen.Onboarding.route) {
                OnboardingScreen(
                    onComplete = {
                        navController.navigate(Screen.Paywall.route) {
                            popUpTo(Screen.Onboarding.route) { inclusive = true }
                        }
                    }
                )
            }

            // Recordings List
            composable(Screen.Recordings.route) {
                RecordingsListScreen(
                    onRecordingClick = { recordingId ->
                        navController.navigate(Screen.RecordingDetail.createRoute(recordingId))
                    },
                    onStartRecording = { navigateGated(Screen.Recording.route) },
                    onSearchClick = {
                        navController.navigate(Screen.Search.route)
                    },
                    onLiveCaptionClick = {
                        navController.navigate(Screen.LiveCaption.route)
                    },
                )
            }

            // Recording Detail
            composable(
                route = Screen.RecordingDetail.route,
                arguments = listOf(
                    navArgument("recordingId") { type = NavType.StringType }
                )
            ) { backStackEntry ->
                val recordingId = backStackEntry.arguments?.getString("recordingId") ?: return@composable
                RecordingDetailScreen(
                    recordingId = recordingId,
                    onNavigateBack = { navController.popBackStack() },
                    onUpgradeClick = { navController.navigate(Screen.Paywall.route) }
                )
            }

            // Recording (Active Recording) - shown as tab
            composable(Screen.Recording.route) {
                RecordingScreen(
                    onRecordingComplete = { recordingId ->
                        navController.navigate(Screen.RecordingDetail.createRoute(recordingId)) {
                            popUpTo(Screen.Recordings.route) { inclusive = false }
                        }
                    },
                    onCancel = { navController.navigate(Screen.Recordings.route) },
                    showAsTab = true
                )
            }

            // Live Caption — deaf / HoH streaming transcript
            composable(Screen.LiveCaption.route) {
                LiveCaptionScreen(
                    onNavigateBack = { navController.popBackStack() },
                )
            }

            // Todos
            composable(Screen.Todos.route) {
                TodosScreen(
                    onRecordingClick = { recordingId ->
                        navController.navigate(Screen.RecordingDetail.createRoute(recordingId))
                    }
                )
            }

            // Meetings
            composable(Screen.Meetings.route) {
                MeetingsScreen(
                    onJoinMeetingClick = { navigateGated(Screen.JoinMeeting.route) },
                    onRecordingClick = { recordingId ->
                        navController.navigate(Screen.RecordingDetail.createRoute(recordingId))
                    },
                    onConnectCalendarClick = {
                        navController.navigate(Screen.CalendarIntegration.route)
                    }
                )
            }

            // Join Meeting - shown as tab
            composable(Screen.JoinMeeting.route) {
                JoinMeetingScreen(
                    onNavigateBack = { navController.navigate(Screen.Recordings.route) },
                    onMeetingJoined = { recordingId ->
                        if (recordingId != null) {
                            // Navigate to recording detail to show live transcript
                            navController.navigate(Screen.RecordingDetail.createRoute(recordingId)) {
                                popUpTo(Screen.Recordings.route) { inclusive = false }
                            }
                        } else {
                            // Fallback to recordings list if no recording ID
                            navController.navigate(Screen.Recordings.route)
                        }
                    },
                    showAsTab = true
                )
            }

            // Calendar Integration
            composable(Screen.CalendarIntegration.route) {
                CalendarIntegrationScreen(
                    onNavigateBack = { navController.popBackStack() }
                )
            }

            // Search
            composable(Screen.Search.route) {
                SearchScreen(
                    onRecordingClick = { recordingId ->
                        navController.navigate(Screen.RecordingDetail.createRoute(recordingId))
                    },
                    onNavigateBack = { navController.popBackStack() }
                )
            }

            // Phone
            composable(Screen.Phone.route) {
                PhoneScreen(
                    onRecordingClick = { recordingId ->
                        navController.navigate(Screen.RecordingDetail.createRoute(recordingId))
                    }
                )
            }

            // Settings
            composable(Screen.Settings.route) {
                SettingsScreen(
                    onCalendarClick = {
                        navController.navigate(Screen.CalendarIntegration.route)
                    },
                    onUpgradeClick = {
                        navController.navigate(Screen.Paywall.route)
                    },
                    onSignOut = {
                        navController.navigate(Screen.Auth.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                )
            }

            // Paywall (soft — onboarding + manual upgrade)
            composable(Screen.Paywall.route) {
                PaywallScreen(
                    onNavigateBack = {
                        // If there's nothing to pop back to (e.g. from onboarding), go to recordings
                        if (!navController.popBackStack()) {
                            navController.navigate(Screen.Recordings.route) {
                                popUpTo(0) { inclusive = true }
                            }
                        }
                    },
                    onPurchaseSuccess = {
                        if (!navController.popBackStack()) {
                            navController.navigate(Screen.Recordings.route) {
                                popUpTo(0) { inclusive = true }
                            }
                        }
                    }
                )
            }

            // HardPaywall — entered when user attempts a gated action past the
            // free limit. Non-dismissable, swallows back.
            composable(Screen.HardPaywall.route) {
                PaywallScreen(
                    onNavigateBack = {
                        // No-op fallback. The PaywallScreen swallows back internally
                        // when forceHardGate=true, but onDismiss can still be invoked
                        // by PaywallView's close button if isDismissible were true.
                    },
                    onPurchaseSuccess = {
                        if (!navController.popBackStack()) {
                            navController.navigate(Screen.Recordings.route) {
                                popUpTo(0) { inclusive = true }
                            }
                        }
                    },
                    forceHardGate = true
                )
            }
        }
        }
    }
}
