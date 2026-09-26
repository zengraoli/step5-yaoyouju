package com.yaoyouju.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.yaoyouju.android.ui.components.NoticeType
import com.yaoyouju.android.ui.components.AppNotice
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3

/** 当前关键变化确认（A02） */
@Composable
fun ChangeScreen(navController: NavHostController) {
    ScreenPlaceholder(title = "当前关键变化确认", code = "A02")
}

/** 就医提示（A03，公开访问） */
@Composable
fun EmergencyScreen(navController: NavHostController) {
    ScreenPlaceholder(title = "就医提示", code = "A03")
}

/** 通用占位页：显示设计编号，便于走查 */
@Composable
fun PlaceholderScreen(title: String, code: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Surface)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text = title, fontSize = 22.sp, color = Text1)
        Spacer(modifier = Modifier.height(6.dp))
        Text(text = "设计稿 $code · 骨架占位", fontSize = 13.sp, color = Text2)
    }
}

@Composable
private fun ScreenPlaceholder(title: String, code: String) {
    PlaceholderScreen(title = title, code = code)
}
