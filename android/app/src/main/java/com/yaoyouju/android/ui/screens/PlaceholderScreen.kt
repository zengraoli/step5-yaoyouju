package com.yaoyouju.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
import com.yaoyouju.android.ui.theme.Text2

/**
 * T43 阶段的占位屏幕：所有页面先用统一占位呈现，保证 deep link 与导航可用。
 * T44–T50 按设计稿逐个替换为真实页面（同名 Composable）。
 */

@Composable
private fun PlaceholderContent(title: String, subtitle: String, navController: NavHostController) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text = title, fontSize = 17.sp)
        Text(text = subtitle, fontSize = 13.sp, color = Text2, modifier = Modifier.padding(top = 8.dp))
        AppButton(
            text = "返回首页",
            type = AppButtonType.Soft,
            modifier = Modifier
                .padding(top = 24.dp)
                .fillMaxWidth(0.6f),
            onClick = { navController.navigate("home") { launchSingleTop = true } },
        )
    }
}

@Composable
fun PlaceholderScreen(navController: NavHostController, title: String) {
    PlaceholderContent(title, "该页面将在后续任务中按设计稿实现", navController)
}

@Composable
fun LoginScreen(navController: NavHostController) {
    PlaceholderContent("A01 登录与授权", "T44 实现", navController)
}

@Composable
fun HomeScreen(navController: NavHostController) {
    PlaceholderContent("A14 当前情况", "T44 实现", navController)
}

@Composable
fun ChangeScreen(navController: NavHostController) {
    PlaceholderContent("A02 当前关键变化确认", "T45 实现", navController)
}

@Composable
fun EmergencyScreen(navController: NavHostController) {
    PlaceholderContent("A03 就医提示", "T45 实现", navController)
}
