package com.yaoyouju.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.yaoyouju.android.data.ServiceLocator
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
import com.yaoyouju.android.ui.components.AppNotice
import com.yaoyouju.android.ui.components.EmergencyEntry
import com.yaoyouju.android.ui.components.NoticeType
import com.yaoyouju.android.ui.navigation.Routes
import com.yaoyouju.android.ui.theme.Border
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3
import kotlinx.coroutines.delay

/**
 * A01 启动 · 登录与授权（设计稿 docs/design/app/A01.png，设计宽度 375）
 *
 * 产品红线：
 * - 「单独同意：处理我的健康信息」独立勾选、默认不勾选，登录时一并提交，可随时撤回；
 * - 就医提示入口不被登录阻断（未登录也可直接进入）；
 * - 已登录用户进入应用直接进首页。
 */
@Composable
fun LoginScreen(navController: NavHostController) {
    val auth = ServiceLocator.authRepository

    var phone by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var agreeTerms by remember { mutableStateOf(true) }
    var healthConsent by remember { mutableStateOf(false) }
    var countdown by remember { mutableIntStateOf(0) }
    var toastText by remember { mutableStateOf("") }
    var action by remember { mutableStateOf("idle") }

    // 已登录用户直接进首页
    LaunchedEffect(Unit) {
        auth.token.collect { value ->
            if (value.isNotBlank()) {
                navController.navigate(Routes.HOME) {
                    popUpTo(Routes.HOME) { inclusive = true }
                    launchSingleTop = true
                }
            }
        }
    }

    // 验证码倒计时
    LaunchedEffect(countdown) {
        if (countdown > 0) {
            delay(1000)
            countdown -= 1
        }
    }

    // toast 自动消失
    LaunchedEffect(toastText) {
        if (toastText.isNotBlank()) {
            delay(2200)
            toastText = ""
        }
    }

    // 发送验证码
    LaunchedEffect(action) {
        if (action == "sending") {
            try {
                val masked = auth.sendSmsCode(phone)
                countdown = 60
                toastText = "验证码已发送至 $masked（演示验证码 123456）"
            } catch (e: Exception) {
                toastText = e.message ?: "验证码发送失败，请稍后重试"
            } finally {
                action = "idle"
            }
        }
    }

    // 登录
    LaunchedEffect(action) {
        if (action == "logging") {
            try {
                auth.login(phone, code)
                try {
                    auth.grantConsent("健康信息处理")
                } catch (e: Exception) {
                    toastText = "已登录，但健康信息处理同意未提交，部分功能暂不可用"
                }
            } catch (e: Exception) {
                toastText = e.message ?: "登录失败，请稍后重试"
            } finally {
                action = "idle"
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Surface)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 32.dp)
            .padding(top = 80.dp, bottom = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(96.dp)
                .clip(RoundedCornerShape(28.dp))
                .background(Primary),
            contentAlignment = Alignment.Center,
        ) {
            Text(text = "腰", fontSize = 44.sp, color = Surface)
        }
        Spacer(modifier = Modifier.height(20.dp))
        Text(text = "腰有据", fontSize = 26.sp, color = Text1)
        Spacer(modifier = Modifier.height(6.dp))
        Text(text = "腰痛理解与复诊助手", fontSize = 14.sp, color = Text2)

        Spacer(modifier = Modifier.height(24.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val cards = listOf(
                "看懂报告" to "术语解释＋原文对照",
                "记录病程" to "低负担，保留来源",
                "准备复诊" to "一页摘要，可导出",
            )
            cards.forEach { (title, desc) ->
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(12.dp))
                        .background(PrimaryLight)
                        .padding(vertical = 12.dp, horizontal = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(text = title, fontSize = 13.sp, color = Text1)
                    Text(text = desc, fontSize = 11.sp, color = Text2)
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        Column(modifier = Modifier.fillMaxWidth()) {
            Text(text = "手机号", fontSize = 13.sp, color = Text2)
            Spacer(modifier = Modifier.height(6.dp))
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it },
                placeholder = { Text("请输入手机号", color = Text3) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        Column(modifier = Modifier.fillMaxWidth()) {
            Text(text = "验证码", fontSize = 13.sp, color = Text2)
            Spacer(modifier = Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it },
                    placeholder = { Text("6位验证码", color = Text3) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.weight(1f),
                )
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = if (countdown > 0) "${countdown} 秒后重试" else "获取验证码",
                    fontSize = 13.sp,
                    color = if (countdown > 0) Text3 else Primary,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(enabled = countdown == 0 && action == "idle") {
                            if (phone.length != 11) {
                                toastText = "请输入正确的 11 位手机号"
                            } else {
                                action = "sending"
                            }
                        }
                        .padding(8.dp),
                )
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        AppButton(
            text = "登录 / 注册",
            type = AppButtonType.Primary,
            block = true,
            loading = action == "logging",
            onClick = {
                when {
                    phone.length != 11 -> toastText = "请输入正确的 11 位手机号"
                    code.length != 6 -> toastText = "请输入 6 位验证码"
                    !agreeTerms -> toastText = "请先阅读并同意《用户协议》《隐私政策》"
                    !healthConsent -> toastText = "请单独同意处理我的健康信息（含检查报告、症状记录）"
                    else -> action = "logging"
                }
            },
        )

        Spacer(modifier = Modifier.height(20.dp))

        ConsentRow(
            checked = agreeTerms,
            onToggle = { agreeTerms = !agreeTerms },
            text = "我已阅读并同意《用户协议》《隐私政策》",
        )
        Spacer(modifier = Modifier.height(12.dp))
        ConsentRow(
            checked = healthConsent,
            onToggle = { healthConsent = !healthConsent },
            text = "单独同意：处理我的健康信息（含检查报告、症状记录，属敏感个人信息）。可随时在“我的-数据与授权”撤回。",
        )

        Spacer(modifier = Modifier.height(24.dp))

        AppNotice(
            type = NoticeType.Info,
            text = "本产品帮助你理解资料与准备复诊，不代替医生诊断，不提供处方或手术判断。",
        )

        Spacer(modifier = Modifier.height(16.dp))

        EmergencyEntry(
            onClick = { navController.navigate(Routes.EMERGENCY) },
        )
    }

    if (toastText.isNotBlank()) {
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

/** 协议勾选行 */
@Composable
private fun ConsentRow(
    checked: Boolean,
    onToggle: () -> Unit,
    text: String,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable { onToggle() }
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier
                .size(22.dp)
                .clip(RoundedCornerShape(5.dp))
                .background(if (checked) Primary else Surface)
                .then(
                    if (checked) Modifier else Modifier.border(1.5.dp, Border, RoundedCornerShape(5.dp)),
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) {
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = null,
                    tint = Surface,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
        Spacer(modifier = Modifier.width(10.dp))
        Text(
            text = text,
            fontSize = 13.sp,
            color = Text2,
            lineHeight = 20.sp,
        )
    }
}
