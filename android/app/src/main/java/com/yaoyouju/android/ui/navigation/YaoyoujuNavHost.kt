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
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.yaoyouju.android.ui.components.BottomNav
import com.yaoyouju.android.ui.screens.LoginScreen
import com.yaoyouju.android.ui.screens.HomeScreen
import com.yaoyouju.android.ui.screens.ChangeScreen
import com.yaoyouju.android.ui.screens.EmergencyScreen
import com.yaoyouju.android.ui.screens.PlaceholderScreen

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
                composable(Routes.EMERGENCY) { EmergencyScreen(navController) }
                composable(Routes.CONFUSION) { PlaceholderScreen(navController, "A04 选择主要困惑") }
                composable(Routes.REPORT_INPUT) { PlaceholderScreen(navController, "A05 录入报告与医嘱") }
                composable(Routes.REPORT_VERIFY) { PlaceholderScreen(navController, "A06 核对结构化信息") }
                composable(Routes.ANALYSIS) { PlaceholderScreen(navController, "A07 一页理性分析") }
                composable(Routes.REPORT_DIFF) { PlaceholderScreen(navController, "A08 原文对照") }
                composable(Routes.QA) { PlaceholderScreen(navController, "A09 问与解释") }
                composable(Routes.TIMELINE) { PlaceholderScreen(navController, "A10 病程时间线") }
                composable(Routes.TODAY) { PlaceholderScreen(navController, "A11 记录今天") }
                composable(Routes.FOLLOWUP) { PlaceholderScreen(navController, "A12 复诊摘要") }
                composable(Routes.CONTENTS) { PlaceholderScreen(navController, "A13 审核内容库") }
                composable(Routes.CONTENT_DETAIL) { PlaceholderScreen(navController, "A15 视频详情") }
                composable(Routes.FEEDBACK) { PlaceholderScreen(navController, "A16 反馈与举报") }
                composable(Routes.MINE) { PlaceholderScreen(navController, "A17 我的") }
                composable(Routes.FALLBACK) { PlaceholderScreen(navController, "A18 服务不可用回退") }
            }
        }
    }

    // deep link 打开对应页面（yaoyouju://A07）
    deepLinkRoute?.let { route ->
        navController.navigate(route) { launchSingleTop = true }
    }
}
