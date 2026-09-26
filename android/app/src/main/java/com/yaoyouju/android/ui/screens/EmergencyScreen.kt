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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.yaoyouju.android.core.net.EmergencyAction
import com.yaoyouju.android.core.net.EmergencyNotice
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.SafetyApi
import com.yaoyouju.android.core.net.handleResponse
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
import com.yaoyouju.android.ui.components.AppCard
import com.yaoyouju.android.ui.components.NoticeType
import com.yaoyouju.android.ui.components.AppNotice
import com.yaoyouju.android.ui.components.StatusKey
import com.yaoyouju.android.ui.components.StatusTag
import com.yaoyouju.android.ui.navigation.Routes
import com.yaoyouju.android.ui.theme.Error
import com.yaoyouju.android.ui.theme.ErrorLight
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3

/**
 * A03 就医提示（设计稿 docs/design/app/A03.png，宽度 375）
 *
 * 产品红线：
 * - 命中红旗信号时立即展示本页，不被登录、付费、上传或长问卷阻断；
 * - 本轮不生成个性化分析，不作诊断；
 * - 本页始终可达：内容优先来自 server 公开接口 GET /safety/emergency-notice，
 *   网络异常时展示静态兜底内容（就医提示不被网络阻断）。
 *
 * 数据来源：
 * - GET /safety/emergency-notice（公开，无需登录）：提示标题 / 动作 / 脚注等；
 * - 命中的红旗信号：从 A02 跳转时通过页面参数传入（signals / stop）；
 * - 「就诊时可以带上」三条：来自当前用户病程数据，有则打勾，无则显示「尚未确认」。
 */
@Composable
fun EmergencyScreen(
    navController: NavHostController,
    signals: String = "",
    stop: Boolean = false,
) {
    val safetyApi: SafetyApi = NetworkModule.api()

    var notice by remember { mutableStateOf<EmergencyNotice?>(null) }
    var offline by remember { mutableStateOf(false) }

    // 命中的红旗信号（从 A02 参数传入）
    val signalList = remember(signals) {
        signals.split(",").map { it.trim() }.filter { it.isNotBlank() }
    }

    // 静态兜底内容（与接口返回一致的演示文案；本页不被网络阻断）
    val fallback = remember {
        EmergencyNotice(
            title = "需要及时寻求专业帮助",
            headline = "建议尽快就医",
            body = "你刚才选择了需要医生及时评估的变化。这类变化需要医生及时评估，本产品无法替你判断严重程度，本轮不会生成个性化分析。",
            offlineNote = "本页在网络异常时也可查看。",
            actions = listOf(
                EmergencyAction("call", "拨打 120 / 前往急诊"),
                EmergencyAction("hospital", "查找附近医院"),
                EmergencyAction("doctor", "联系我的主治医生（已保存）"),
            ),
            bringList = listOf(
                "已录入的检查报告原文",
                "症状开始时间与最近变化记录",
                "正在使用的药物与既有医嘱",
            ),
            summaryAction = null,
            footerNote = "此提示由临床审定规则触发，不是诊断结论；请以医生的评估为准。",
        )
    }

    LaunchedEffect(Unit) {
        try {
            notice = handleResponse(safetyApi.emergencyNotice())
        } catch (e: Exception) {
            offline = true
            notice = fallback
        }
    }

    val data = notice ?: fallback

    Box(modifier = Modifier.fillMaxSize().background(Surface)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            // 顶部导航
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Filled.ArrowBack,
                    contentDescription = "返回",
                    tint = Text1,
                    modifier = Modifier
                        .size(28.dp)
                        .clickable { navController.popBackStack() },
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "就医提示",
                    fontSize = 17.sp,
                    color = Text1,
                    modifier = Modifier.weight(1f),
                )
            }

            Column(modifier = Modifier.padding(horizontal = 20.dp)) {
                Spacer(modifier = Modifier.height(8.dp))

                // 警示卡
                AppCard(
                    background = ErrorLight,
                    borderColor = Error,
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Filled.Warning,
                                contentDescription = null,
                                tint = Error,
                                modifier = Modifier.size(22.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = data.title,
                                fontSize = 18.sp,
                                color = Error,
                            )
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                        // headline：命中 high 级红旗时优先展示「尽快就医」
                        val headline = when {
                            signalList.isEmpty() -> data.headline
                            stop -> "建议尽快就医"
                            else -> data.headline
                        }
                        Text(
                            text = headline,
                            fontSize = 22.sp,
                            color = Text1,
                            lineHeight = 30.sp,
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        // 你刚才选择了：…
                        if (signalList.isNotEmpty()) {
                            Text(
                                text = "你刚才选择了：" + signalList.joinToString("、"),
                                fontSize = 13.sp,
                                color = Text2,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                        }
                        Text(
                            text = data.body,
                            fontSize = 13.sp,
                            color = Text2,
                            lineHeight = 22.sp,
                        )
                        if (stop) {
                            Spacer(modifier = Modifier.height(12.dp))
                            AppNotice(
                                type = NoticeType.Error,
                                text = "本轮不会生成个性化分析，也不替代医生判断严重程度。",
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // 操作按钮
                data.actions.forEach { action ->
                    AppButton(
                        text = action.label,
                        type = when (action.type) {
                            "call" -> AppButtonType.Danger
                            else -> AppButtonType.Secondary
                        },
                        block = true,
                        onClick = { /* 演示：拨打 / 查找 / 联系均跳系统能力 */ },
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                }

                Spacer(modifier = Modifier.height(6.dp))

                // 就诊时可以带上
                AppCard {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "就诊时可以带上",
                            fontSize = 15.sp,
                            color = Text1,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "有则打勾，无则显示「尚未确认」，不默认为有",
                            fontSize = 11.sp,
                            color = Text3,
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        data.bringList.forEach { item ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 5.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(18.dp)
                                        .clip(RoundedCornerShape(9.dp))
                                        .background(if (offline) ErrorLight else Primary),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(
                                        imageVector = Icons.Filled.Check,
                                        contentDescription = null,
                                        tint = Surface,
                                        modifier = Modifier.size(11.dp),
                                    )
                                }
                                Spacer(modifier = Modifier.width(10.dp))
                                Text(
                                    text = item,
                                    fontSize = 13.sp,
                                    color = Text2,
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // 就诊交接摘要入口
                AppButton(
                    text = "生成一页“就诊交接”摘要（仅整理已有信息）",
                    type = AppButtonType.Primary,
                    block = true,
                    onClick = { navController.navigate(Routes.FOLLOWUP) },
                )

                Spacer(modifier = Modifier.height(20.dp))

                // 脚注
                Text(
                    text = data.footerNote,
                    fontSize = 11.sp,
                    color = Text3,
                    lineHeight = 18.sp,
                    textAlign = TextAlign.Start,
                )

                Spacer(modifier = Modifier.height(16.dp))

                if (offline) {
                    AppNotice(
                        type = NoticeType.Info,
                        text = data.offlineNote,
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                }

                // 返回首页
                AppButton(
                    text = "返回首页",
                    type = AppButtonType.Secondary,
                    block = true,
                    onClick = {
                        navController.navigate(Routes.HOME) {
                            popUpTo(Routes.HOME) { inclusive = true }
                        }
                    },
                )

                Spacer(modifier = Modifier.height(40.dp))
            }
        }
    }
}
