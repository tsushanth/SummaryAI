package com.kreativekoala.summaryai.ui.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.VideoCall
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.VideoCall
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import com.kreativekoala.summaryai.ui.recording.RecordingScreen
import com.kreativekoala.summaryai.ui.recordings.RecordingDetailScreen
import com.kreativekoala.summaryai.ui.recordings.RecordingsListScreen
import com.kreativekoala.summaryai.ui.search.SearchScreen
import com.kreativekoala.summaryai.ui.settings.SettingsScreen
import com.kreativekoala.summaryai.ui.todos.TodosScreen

// Navigation routes
sealed class Screen(val route: String) {
    object Auth : Screen("auth")
    object Onboarding : Screen("onboarding")
    object Recordings : Screen("recordings")
    object RecordingDetail : Screen("recordings/{recordingId}") {
        fun createRoute(recordingId: String) = "recordings/$recordingId"
    }
    object Recording : Screen("recording")
    object Todos : Screen("todos")
    object Meetings : Screen("meetings")
    object JoinMeeting : Screen("meetings/join")
    object CalendarIntegration : Screen("calendar")
    object Search : Screen("search")
    object Settings : Screen("settings")
    object Paywall : Screen("paywall")
}

// Bottom navigation items
data class BottomNavItem(
    val screen: Screen,
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
)

val bottomNavItems = listOf(
    BottomNavItem(
        screen = Screen.Recordings,
        title = "Recordings",
        selectedIcon = Icons.Filled.Mic,
        unselectedIcon = Icons.Outlined.Mic
    ),
    BottomNavItem(
        screen = Screen.Todos,
        title = "Action Items",
        selectedIcon = Icons.Filled.Checklist,
        unselectedIcon = Icons.Outlined.Checklist
    ),
    BottomNavItem(
        screen = Screen.Meetings,
        title = "Meetings",
        selectedIcon = Icons.Filled.VideoCall,
        unselectedIcon = Icons.Outlined.VideoCall
    ),
    BottomNavItem(
        screen = Screen.Settings,
        title = "Settings",
        selectedIcon = Icons.Filled.Settings,
        unselectedIcon = Icons.Outlined.Settings
    )
)

@Composable
fun MeetingMindNavGraph(
    isAuthenticated: Boolean,
    hasCompletedOnboarding: Boolean,
    navController: NavHostController = rememberNavController()
) {
    val startDestination = when {
        !isAuthenticated -> Screen.Auth.route
        !hasCompletedOnboarding -> Screen.Onboarding.route
        else -> Screen.Recordings.route
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    // Determine if we should show bottom nav
    val showBottomNav = isAuthenticated && hasCompletedOnboarding &&
            currentDestination?.route in listOf(
        Screen.Recordings.route,
        Screen.Todos.route,
        Screen.Meetings.route,
        Screen.Settings.route
    )

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
                                navController.navigate(item.screen.route) {
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = {
                                Icon(
                                    imageVector = if (selected) item.selectedIcon else item.unselectedIcon,
                                    contentDescription = item.title
                                )
                            },
                            label = { Text(item.title) }
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
                        navController.navigate(Screen.Recordings.route) {
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
                    onStartRecording = {
                        navController.navigate(Screen.Recording.route)
                    },
                    onSearchClick = {
                        navController.navigate(Screen.Search.route)
                    }
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

            // Recording (Active Recording)
            composable(Screen.Recording.route) {
                RecordingScreen(
                    onRecordingComplete = { recordingId ->
                        navController.navigate(Screen.RecordingDetail.createRoute(recordingId)) {
                            popUpTo(Screen.Recording.route) { inclusive = true }
                        }
                    },
                    onCancel = { navController.popBackStack() }
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
                    onJoinMeetingClick = {
                        navController.navigate(Screen.JoinMeeting.route)
                    },
                    onRecordingClick = { recordingId ->
                        navController.navigate(Screen.RecordingDetail.createRoute(recordingId))
                    },
                    onConnectCalendarClick = {
                        navController.navigate(Screen.CalendarIntegration.route)
                    }
                )
            }

            // Join Meeting
            composable(Screen.JoinMeeting.route) {
                JoinMeetingScreen(
                    onNavigateBack = { navController.popBackStack() },
                    onMeetingJoined = { navController.popBackStack() }
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

            // Paywall
            composable(Screen.Paywall.route) {
                PaywallScreen(
                    onNavigateBack = { navController.popBackStack() },
                    onPurchaseSuccess = { navController.popBackStack() }
                )
            }
        }
    }
}
