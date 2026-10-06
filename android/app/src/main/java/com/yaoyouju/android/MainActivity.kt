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
 * deep link：yaoyoujuapp://A07 直接打开对应设计稿编号的页面（adb 测试用）。
 */
class MainActivity : ComponentActivity() {

    private val deepLinkRoute = mutableStateOf<String?>(null)
    /**
     * deep link 序号：同一页面重复打开也要能重新跳转。
     * 只靠路由名做 LaunchedEffect 的 key 时，第二次打开同一个链接值不变、不会重组（第七轮第 33 条）。
     */
    private val deepLinkNonce = mutableStateOf(0L)
    /** 本地令牌（null = 尚未读取；空串 = 未登录） */
    private val savedToken = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        // 启动时读取本地令牌并用 /auth/me 校验：令牌已被服务端失效时直接进登录页，
        // 不再带着旧令牌进首页后各页显示「手机号未确认 / 还没有同意记录」（验收反馈第 35 条）
        lifecycleScope.launch {
            val token = ServiceLocator.tokenStore.token.first()
            ServiceLocator.authRepository.restoreToken(token)
            savedToken.value = if (token.isBlank()) {
                ""
            } else {
                try {
                    ServiceLocator.authRepository.me()
                    token
                } catch (e: Exception) {
                    // 区分「网络 / 服务端问题」与「令牌确实失效」：
                    // 断网或 5xx 只是暂时不能校验，保留登录态进首页（不因网络异常把已登录用户踢回登录页）；
                    // 仅当令牌被明确鉴权拒绝（401 / 40100…）才登出清除（源码风险 #1，第九轮反馈）
                    val ex = com.yaoyouju.android.core.net.networkErrorOf(e)
                    if (ex.network || ex.code in 500..599) {
                        token
                    } else {
                        ServiceLocator.authRepository.logout()
                        ""
                    }
                }
            }
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
                        deepLinkNonce = deepLinkNonce.value,
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
            deepLinkNonce.value += 1
        }
    }
}
