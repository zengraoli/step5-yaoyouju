package com.yaoyouju.android.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.yaoyouju.android.ui.components.BottomNav
import com.yaoyouju.android.ui.screens.LoginScreen
import com.yaoyouju.android.ui.screens.HomeScreen
import com.yaoyouju.android.ui.screens.ChangeScreen
import com.yaoyouju.android.ui.screens.EmergencyScreen
import com.yaoyouju.android.ui.screens.AnalysisScreen
import com.yaoyouju.android.ui.screens.ContentDetailScreen
import com.yaoyouju.android.ui.screens.ContentListScreen
import com.yaoyouju.android.ui.screens.ConfusionScreen
import com.yaoyouju.android.ui.screens.FallbackScreen
import com.yaoyouju.android.ui.screens.FeedbackScreen
import com.yaoyouju.android.ui.screens.MineScreen
import com.yaoyouju.android.ui.screens.FollowupScreen
import com.yaoyouju.android.ui.screens.ReportDiffScreen
import com.yaoyouju.android.ui.screens.PlaceholderScreen
import com.yaoyouju.android.ui.screens.QaScreen
import com.yaoyouju.android.ui.screens.TimelineScreen
import com.yaoyouju.android.ui.screens.TodayScreen
import com.yaoyouju.android.ui.screens.ReportInputScreen
import com.yaoyouju.android.ui.screens.ReportVerifyScreen

/** 底部导航五个入口（其余页面不入底部导航） */
private val BOTTOM_ROUTES = setOf(
    Routes.HOME, Routes.QA, Routes.TIMELINE, Routes.FOLLOWUP, Routes.MINE,
)

@Composable
fun YaoyoujuApp(deepLinkRoute: String? = null) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    Scaffold(
        bottomBar = {
            if (currentRoute in BOTTOM_ROUTES) {
                BottomNav(
                    currentRoute = currentRoute,
                    onSelect = { route ->
                        navController.navigate(route) {
                            popUpTo(Routes.HOME) { inclusive = route == Routes.HOME }
                            launchSingleTop = true
                        }
                    },
                )
            }
        },
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            NavHost(navController = navController, startDestination = Routes.HOME) {
                composable(Routes.HOME) { HomeScreen(navController) }
                composable(Routes.LOGIN) { LoginScreen(navController) }
                composable(Routes.CHANGE) { ChangeScreen(navController) }
                composable(
    route = Routes.EMERGENCY + "?signals={signals}&stop={stop}",
    arguments = listOf(
        navArgument("signals") { defaultValue = "" },
        navArgument("stop") { defaultValue = false },
    ),
) { entry ->
    EmergencyScreen(
        navController = navController,
        signals = entry.arguments?.getString("signals") ?: "",
        stop = entry.arguments?.getBoolean("stop") ?: false,
    )
}
                composable(Routes.CONFUSION) { ConfusionScreen(navController) }
                composable(Routes.REPORT_INPUT) { ReportInputScreen(navController) }
                composable(Routes.REPORT_VERIFY) { ReportVerifyScreen(navController) }
                composable(
    route = Routes.ANALYSIS + "?taskId={taskId}&analysisId={analysisId}",
    arguments = listOf(
        navArgument("taskId") { defaultValue = "" },
        navArgument("analysisId") { defaultValue = "" },
    ),
) { entry ->
    AnalysisScreen(
        navController = navController,
        taskId = entry.arguments?.getString("taskId") ?: "",
        analysisId = entry.arguments?.getString("analysisId") ?: "",
    )
}
                composable(
    route = Routes.REPORT_DIFF + "?analysisId={analysisId}&explainIndex={explainIndex}",
    arguments = listOf(
        navArgument("analysisId") { defaultValue = "" },
        navArgument("explainIndex") { defaultValue = 0 },
    ),
) { entry ->
    ReportDiffScreen(
        navController = navController,
        analysisId = entry.arguments?.getString("analysisId") ?: "",
        explainIndex = entry.arguments?.getInt("explainIndex") ?: 0,
    )
}
                composable(Routes.QA) { QaScreen(navController) }
                composable(Routes.TIMELINE) { TimelineScreen(navController) }
                composable(Routes.TODAY) { TodayScreen(navController) }
                composable(Routes.FOLLOWUP) { FollowupScreen(navController) }
                composable(Routes.CONTENTS) { ContentListScreen(navController) }
                composable(
    route = Routes.CONTENT_DETAIL + "?contentId={contentId}",
    arguments = listOf(navArgument("contentId") { defaultValue = "" }),
) { entry ->
    ContentDetailScreen(
        navController = navController,
        contentId = entry.arguments?.getString("contentId") ?: "",
    )
}
                composable(
    route = Routes.FEEDBACK + "?analysisId={analysisId}",
    arguments = listOf(navArgument("analysisId") { defaultValue = "" }),
) { entry ->
    FeedbackScreen(
        navController = navController,
        analysisId = entry.arguments?.getString("analysisId") ?: "",
    )
}
                composable(Routes.MINE) { MineScreen(navController) }
                composable(
    route = Routes.FALLBACK + "?taskId={taskId}",
    arguments = listOf(navArgument("taskId") { defaultValue = "" }),
) { entry ->
    FallbackScreen(
        navController = navController,
        taskId = entry.arguments?.getString("taskId") ?: "",
    )
}
            }
        }
    }

    // deep link 打开对应页面（yaoyouju://A07）
    deepLinkRoute?.let { route ->
        navController.navigate(route) { launchSingleTop = true }
    }
}
