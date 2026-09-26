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
import com.yaoyouju.android.ui.screens.ConfusionScreen
import com.yaoyouju.android.ui.screens.PlaceholderScreen
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
                composable(Routes.ANALYSIS) { PlaceholderScreen(title = "A07 一页理性分析", code = "A07") }
                composable(Routes.REPORT_DIFF) { PlaceholderScreen(title = "A08 原文对照", code = "A08") }
                composable(Routes.QA) { PlaceholderScreen(title = "A09 问与解释", code = "A09") }
                composable(Routes.TIMELINE) { PlaceholderScreen(title = "A10 病程时间线", code = "A10") }
                composable(Routes.TODAY) { PlaceholderScreen(title = "A11 记录今天", code = "A11") }
                composable(Routes.FOLLOWUP) { PlaceholderScreen(title = "A12 复诊摘要", code = "A12") }
                composable(Routes.CONTENTS) { PlaceholderScreen(title = "A13 审核内容库", code = "A13") }
                composable(Routes.CONTENT_DETAIL) { PlaceholderScreen(title = "A15 视频详情", code = "A15") }
                composable(Routes.FEEDBACK) { PlaceholderScreen(title = "A16 反馈与举报", code = "A16") }
                composable(Routes.MINE) { PlaceholderScreen(title = "A17 我的", code = "A17") }
                composable(Routes.FALLBACK) { PlaceholderScreen(title = "A18 服务不可用回退", code = "A18") }
            }
        }
    }

    // deep link 打开对应页面（yaoyouju://A07）
    deepLinkRoute?.let { route ->
        navController.navigate(route) { launchSingleTop = true }
    }
}
