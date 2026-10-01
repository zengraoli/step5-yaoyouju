package com.yaoyouju.android.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
fun YaoyoujuApp(
    deepLinkRoute: String? = null,
    startDestination: String = Routes.HOME,
) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    // 带参数的页面（如 analysis?taskId=…）也要能高亮对应的底部 Tab
    val currentHierarchy: Set<String> = remember(currentRoute) {
        val route = currentRoute ?: return@remember emptySet()
        when {
            route.startsWith(Routes.ANALYSIS) -> setOf(Routes.HOME)
            route.startsWith(Routes.REPORT_DIFF) -> setOf(Routes.HOME)
            route.startsWith(Routes.REPORT_INPUT) || route.startsWith(Routes.REPORT_VERIFY) -> setOf(Routes.HOME)
            route.startsWith(Routes.CONTENTS) || route.startsWith(Routes.CONTENT_DETAIL) -> setOf(Routes.HOME)
            route.startsWith(Routes.CONFUSION) -> setOf(Routes.HOME)
            route.startsWith(Routes.TODAY) -> setOf(Routes.TIMELINE)
            route.startsWith(Routes.FALLBACK) -> setOf(Routes.HOME)
            route.startsWith(Routes.EMERGENCY) -> setOf(Routes.HOME)
            else -> setOf(route)
        }
    }

    Scaffold(
        bottomBar = {
            if (currentRoute in BOTTOM_ROUTES) {
                BottomNav(
                    currentRoute = currentRoute,
                    selectedRoutes = currentHierarchy,
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
            NavHost(navController = navController, startDestination = startDestination) {
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

    // deep link 打开对应页面（yaoyoujuapp://A07）。
    // 必须在图设置完成之后再跳转：组合期直接 navigate 会抛
    // "Navigation graph has not been set for NavController"（验收反馈第 19 条）。
    // 注意：带查询参数的路由要补全参数后再跳转，否则 getBackStackEntry 找不到目标。
    LaunchedEffect(deepLinkRoute) {
        val target = deepLinkRoute ?: return@LaunchedEffect
        val full = DEEP_LINK_ROUTES[target] ?: target
        navController.navigate(full) { launchSingleTop = true }
    }
}

/** deep link 路由名 → 完整路由（带默认参数） */
private val DEEP_LINK_ROUTES: Map<String, String> = mapOf(
    Routes.EMERGENCY to "${Routes.EMERGENCY}?signals=&stop=false",
    Routes.ANALYSIS to "${Routes.ANALYSIS}?taskId=&analysisId=",
    Routes.REPORT_DIFF to "${Routes.REPORT_DIFF}?analysisId=&explainIndex=0",
    Routes.CONTENT_DETAIL to "${Routes.CONTENT_DETAIL}?contentId=",
    Routes.FEEDBACK to "${Routes.FEEDBACK}?analysisId=",
    Routes.FALLBACK to "${Routes.FALLBACK}?taskId=",
)
