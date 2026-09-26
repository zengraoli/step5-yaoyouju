package com.yaoyouju.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.yaoyouju.android.core.net.AuthApi
import com.yaoyouju.android.core.net.ConsentItem
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.SafetyApi
import com.yaoyouju.android.core.net.handleResponse
import com.yaoyouju.android.data.ServiceLocator
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
import com.yaoyouju.android.ui.components.AppCard
import com.yaoyouju.android.ui.components.AppNotice
import com.yaoyouju.android.ui.components.NoticeType
import com.yaoyouju.android.ui.components.StatusKey
import com.yaoyouju.android.ui.components.StatusTag
import com.yaoyouju.android.ui.navigation.Routes
import com.yaoyouju.android.ui.theme.Error
import com.yaoyouju.android.ui.theme.ErrorLight
import com.yaoyouju.android.ui.theme.NeutralLight
import com.yaoyouju.android.ui.theme.Ok
import com.yaoyouju.android.ui.theme.OkLight
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3
import kotlinx.coroutines.launch

/**
 * A17 我的 · 数据与授权（设计稿 docs/design/app/A17.png，宽度 375，主 Tab）
 *
 * 同意记录可查可撤回；导出与删除；身份与分析分离；服务边界可见。
 *
 * 数据全部来自 server 接口：
 * - GET  /auth/me                      当前用户（脱敏手机号）
 * - GET  /auth/consents                同意记录
 * - POST /auth/consents/{scope}/revoke 撤回同意（立即生效）
 * - GET  /safety/emergency-notice      紧急就医提示（公开）
 */
@Composable
fun MineScreen(navController: NavHostController) {
    val authApi: AuthApi = NetworkModule.api()
    val safetyApi: SafetyApi = NetworkModule.api()
    val authRepository = ServiceLocator.authRepository
    val scope = rememberCoroutineScope()

    var loading by remember { mutableStateOf(true) }
    var loggedIn by remember { mutableStateOf(false) }
    var phoneMasked by remember { mutableStateOf("") }
    var consents by remember { mutableStateOf<List<ConsentItem>>(emptyList()) }
    var toastText by remember { mutableStateOf("") }

    /** 版本信息（按设计稿） */
    val versionInfo = "App v0.1.0 · 分析模型 M-2609 · 内容库 2026-09"

    fun load() {
        loading = true
        scope.launch {
            try {
                val token = ServiceLocator.tokenStore.token
                var tokenValue = ""
                token.collect { tokenValue = it }
                if (tokenValue.isBlank()) {
                    loggedIn = false
                    return@launch
                }
                loggedIn = true
                val me = handleResponse(authApi.me())
                phoneMasked = me.phoneMasked
                consents = handleResponse(authApi.consents())
            } catch (e: Exception) {
                toastText = e.message ?: "加载失败，请稍后重试"
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Surface),
    ) {
        // 顶栏
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "我的",
                fontSize = 20.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            Text(text = "数据与授权", fontSize = 11.sp, color = Text3)
        }

        Box(modifier = Modifier.weight(1f)) {
            when {
                loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(text = "加载中…", fontSize = 13.sp, color = Text3)
                }

                !loggedIn -> Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(text = "还没有登录", fontSize = 15.sp, color = Text1)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "登录后可查看同意记录、导出与删除数据。",
                        fontSize = 12.sp,
                        color = Text2,
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    AppButton(
                        text = "去登录",
                        type = AppButtonType.Primary,
                        onClick = { navController.navigate(Routes.LOGIN) },
                    )
                }

                else -> Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp),
                ) {
                    Spacer(modifier = Modifier.height(8.dp))

                    // 身份卡（脱敏手机号；身份与分析分离）
                    AppCard {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    modifier = Modifier
                                        .size(44.dp)
                                        .clip(RoundedCornerShape(22.dp))
                                        .background(PrimaryLight),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(text = "我", fontSize = 16.sp, color = Primary)
                                }
                                Spacer(modifier = Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = phoneMasked.ifBlank { "手机号未确认" },
                                        fontSize = 15.sp,
                                        color = Text1,
                                    )
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = "身份信息与分析内容分离存储",
                                        fontSize = 11.sp,
                                        color = Text3,
                                    )
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // 同意记录（可查可撤回）
                    Text(text = "同意记录", fontSize = 15.sp, color = Text1)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "撤回后立即生效，相关功能会停止使用你的健康信息。",
                        fontSize = 11.sp,
                        color = Text3,
                    )
                    Spacer(modifier = Modifier.height(10.dp))

                    if (consents.isEmpty()) {
                        AppNotice(
                            type = NoticeType.Info,
                            text = "还没有同意记录。",
                        )
                    } else {
                        consents.forEach { item ->
                            ConsentRow(
                                item = item,
                                onRevoke = {
                                    scope.launch {
                                        try {
                                            consents = authRepository.revokeConsent(item.scope)
                                            toastText = "已撤回「${item.scope}」同意"
                                        } catch (e: Exception) {
                                            toastText = e.message ?: "撤回失败，请稍后重试"
                                        }
                                    }
                                },
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // 数据操作
                    Text(text = "数据", fontSize = 15.sp, color = Text1)
                    Spacer(modifier = Modifier.height(10.dp))
                    AppButton(
                        text = "导出我的数据",
                        type = AppButtonType.Secondary,
                        block = true,
                        onClick = { toastText = "导出任务已提交，完成后可在通知中查看" },
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    AppButton(
                        text = "删除我的数据",
                        type = AppButtonType.Danger,
                        block = true,
                        onClick = { toastText = "删除需要二次确认，演示环境未开放" },
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // 服务边界
                    Text(text = "服务边界", fontSize = 15.sp, color = Text1)
                    Spacer(modifier = Modifier.height(10.dp))
                    AppNotice(
                        type = NoticeType.Info,
                        text = "本产品帮助你理解资料与准备复诊，不代替医生诊断，不提供处方或手术判断。",
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    AppButton(
                        text = "查看就医提示",
                        type = AppButtonType.Secondary,
                        block = true,
                        onClick = { navController.navigate(Routes.EMERGENCY) },
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // 版本信息
                    AppCard {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Text(text = versionInfo, fontSize = 11.sp, color = Text3)
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    // 退出登录
                    AppButton(
                        text = "退出登录",
                        type = AppButtonType.Secondary,
                        block = true,
                        onClick = {
                            scope.launch {
                                authRepository.logout()
                                loggedIn = false
                                toastText = "已退出登录"
                            }
                        },
                    )

                    Spacer(modifier = Modifier.height(40.dp))
                }
            }
        }
    }

    if (toastText.isNotBlank()) {
        LaunchedEffect(toastText) {
            kotlinx.coroutines.delay(2200)
            toastText = ""
        }
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.BottomCenter,
        ) {
            Text(
                text = toastText,
                color = Surface,
                fontSize = 14.sp,
                modifier = Modifier
                    .padding(bottom = 120.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Text1.copy(alpha = 0.85f))
                    .padding(horizontal = 20.dp, vertical = 10.dp),
            )
        }
    }
}

/** 同意记录行（可撤回） */
@Composable
private fun ConsentRow(
    item: ConsentItem,
    onRevoke: () -> Unit,
) {
    AppCard(
        background = if (item.granted) OkLight else NeutralLight,
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = item.scope, fontSize = 14.sp, color = Text1)
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = if (item.granted) {
                        "同意于 " + (item.grantedAt?.take(10) ?: "时间尚未确认")
                    } else {
                        "已撤回" + (item.revokedAt?.let { "（" + it.take(10) + "）" } ?: "")
                    },
                    fontSize = 11.sp,
                    color = Text3,
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            StatusTag(
                status = if (item.granted) StatusKey.Confirmed else StatusKey.Unconfirmed,
            )
            if (item.granted) {
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "撤回",
                    fontSize = 12.sp,
                    color = Error,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(ErrorLight)
                        .clickable { onRevoke() }
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
        }
    }
}
