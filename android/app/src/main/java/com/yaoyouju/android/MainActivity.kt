package com.yaoyouju.android

import android.content.Intent
import android.os.Bundle
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import com.yaoyouju.android.data.ServiceLocator
import com.yaoyouju.android.ui.navigation.Routes
import com.yaoyouju.android.ui.theme.Surface
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.mutableStateOf
import com.yaoyouju.android.core.deepLink.DeepLinks
import com.yaoyouju.android.core.net.TokenProvider
import com.yaoyouju.android.ui.navigation.YaoyoujuApp
import com.yaoyouju.android.ui.theme.YaoyoujuTheme

/**
 * 单 Activity + Compose Navigation。
 * deep link：yaoyouju://A07 直接打开对应设计稿编号的页面（adb 测试用）。
 */
class MainActivity : ComponentActivity() {

    private val deepLinkRoute = mutableStateOf<String?>(null)
    /** 本地令牌（null = 尚未读取；空串 = 未登录） */
    private val savedToken = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        // 启动时读取本地令牌：未登录直接进登录页（验收反馈第 17 条）
        lifecycleScope.launch {
            val token = ServiceLocator.tokenStore.token.first()
            ServiceLocator.authRepository.restoreToken(token)
            savedToken.value = token
        }
        setContent {
            YaoyoujuTheme {
                val token = savedToken.value
                if (token == null) {
                    // 读取中：留白，避免未登录用户看到首页数据
                    Box(modifier = Modifier.fillMaxSize().background(Surface))
                } else {
                    YaoyoujuApp(
                        deepLinkRoute = deepLinkRoute.value,
                        startDestination = if (token.isBlank()) Routes.LOGIN else Routes.HOME,
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** 解析 yaoyoujuapp://<页面编号>，如 yaoyoujuapp://A07 */
    private fun handleIntent(intent: Intent?) {
        val target = DeepLinks.parse(intent?.data?.toString())
        if (target != null) {
            deepLinkRoute.value = target.route
        }
    }
}
