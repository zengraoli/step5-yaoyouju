package com.yaoyouju.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yaoyouju.android.ui.navigation.Routes
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text2

/**
 * 底部导航（与 App 端一致）：当前情况 / 问与解释 / 病程 / 复诊准备 / 我的。
 * 图标使用 Material Icons（本地，不加载外部资源），当前项主色。
 */
private data class TabVisual(val route: String, val label: String, val icon: ImageVector)

@Composable
fun BottomNav(
    currentRoute: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tabs = listOf(
        TabVisual(Routes.HOME, "当前情况", Icons.Filled.Home),
        TabVisual(Routes.QA, "问与解释", Icons.Filled.Chat),
        TabVisual(Routes.TIMELINE, "病程", Icons.Filled.Timeline),
        TabVisual(Routes.FOLLOWUP, "复诊准备", Icons.Filled.Assignment),
        TabVisual(Routes.MINE, "我的", Icons.Filled.Person),
    )
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Surface)
            .navigationBarsPadding()
            .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceAround,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tabs.forEach { tab ->
            val selected = currentRoute == tab.route
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .clickable { onSelect(tab.route) }
                    .padding(horizontal = 12.dp, vertical = 4.dp),
            ) {
                Icon(
                    imageVector = tab.icon,
                    contentDescription = tab.label,
                    tint = if (selected) Primary else Text2,
                )
                Text(
                    text = tab.label,
                    fontSize = 11.sp,
                    color = if (selected) Primary else Text2,
                )
            }
        }
    }
}
