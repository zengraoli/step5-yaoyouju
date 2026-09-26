package com.yaoyouju.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.mutableStateOf
import com.yaoyouju.android.core.deepLink.DeepLinks
import com.yaoyouju.android.ui.navigation.YaoyoujuApp
import com.yaoyouju.android.ui.theme.YaoyoujuTheme

/**
 * 单 Activity + Compose Navigation。
 * deep link：yaoyouju://A07 直接打开对应设计稿编号的页面（adb 测试用）。
 */
class MainActivity : ComponentActivity() {

    private val deepLinkRoute = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        setContent {
            YaoyoujuTheme {
                YaoyoujuApp(deepLinkRoute = deepLinkRoute.value)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** 解析 yaoyouju://<页面编号>，如 yaoyouju://A07 */
    private fun handleIntent(intent: Intent?) {
        val target = DeepLinks.parse(intent?.data?.toString())
        if (target != null) {
            deepLinkRoute.value = target.route
        }
    }
}
