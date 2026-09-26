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
import androidx.compose.material3.Icon
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
import com.yaoyouju.android.core.net.AnalysesApi
import com.yaoyouju.android.core.net.EpisodesApi
import com.yaoyouju.android.core.net.FollowupApi2
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.handleResponse
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
import com.yaoyouju.android.ui.theme.Info
import com.yaoyouju.android.ui.theme.InfoLight
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
 * A18 服务不可用回退（设计稿 docs/design/app/A18.png，宽度 375）
 *
 * 模型 / 检索 / 来源校验失败时明确说明；保留已审核资料与摘要功能；
 * 不无限重试与重复计费；就医提示不依赖网络。
 *
 * 数据说明：失败原因来自一页分析任务查询（GET /analyses/task/{taskId} 的 reason），
 * 已保存信息来自服务端回退内容（fallback）；本页同时提供低带宽可读的静态结构。
 */
@Composable
fun FallbackScreen(
    navController: NavHostController,
    taskId: String = "",
) {
    val analysesApi: AnalysesApi = NetworkModule.api()
    val episodesApi: EpisodesApi = NetworkModule.api()
    val followupApi: FollowupApi2 = NetworkModule.api()
    val scope = rememberCoroutineScope()

    var reason by remember { mutableStateOf("") }
    var savedInfo by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }

    /** 错误码（服务端 SERVICE_UNAVAILABLE = 50300 → 展示码 ANL-503） */
    val errorCode = "ANL-503"

    LaunchedEffect(Unit) {
        loading = true
        try {
            if (taskId.isNotBlank()) {
                val task = handleResponse(analysesApi.task(taskId))
                reason = task.reason ?: "分析服务暂时不可用"
            } else {
                reason = "分析服务暂时不可用"
            }
            // 检查是否有已保存的摘要（保留摘要功能）
            val episodes = handleResponse(episodesApi.list())
            val episode = episodes.firstOrNull()
            if (episode != null) {
                savedInfo = try {
                    handleResponse(followupApi.latest(episode.id))
                    true
                } catch (_: Exception) {
                    false
                }
            }
        } catch (e: Exception) {
            reason = e.message ?: "服务暂时不可用"
        } finally {
            loading = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Surface),
    ) {
        // 导航栏
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
                text = "服务暂时不可用",
                fontSize = 17.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            Text(text = errorCode, fontSize = 12.sp, color = Error)
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            // 失败说明
            AppCard(
                background = ErrorLight,
                borderColor = Error,
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(text = "出了点问题", fontSize = 16.sp, color = Error)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "原因：" + reason,
                        fontSize = 13.sp,
                        color = Text2,
                        lineHeight = 20.sp,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "可能是模型服务、检索服务或来源校验暂时不可用。我们不会无限重试，也不会重复计费。",
                        fontSize = 12.sp,
                        color = Text3,
                        lineHeight = 20.sp,
                    )
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // 仍然可用
            Text(text = "现在仍然可以", fontSize = 15.sp, color = Text1)
            Spacer(modifier = Modifier.height(10.dp))

            FallbackFeatureRow(
                title = "查看已审核资料",
                desc = "内容库与详情不依赖分析服务",
                available = true,
                onClick = { navController.navigate(Routes.CONTENTS) },
            )
            Spacer(modifier = Modifier.height(8.dp))
            FallbackFeatureRow(
                title = "查看 / 导出复诊摘要",
                desc = if (savedInfo) "你已有保存的摘要，可继续查看与导出" else "还没有生成过摘要",
                available = savedInfo,
                onClick = { if (savedInfo) navController.navigate(Routes.FOLLOWUP) },
            )
            Spacer(modifier = Modifier.height(8.dp))
            FallbackFeatureRow(
                title = "查看就医提示",
                desc = "不依赖网络，内容常驻本机",
                available = true,
                onClick = { navController.navigate(Routes.EMERGENCY) },
            )

            Spacer(modifier = Modifier.height(20.dp))

            // 暂不可用
            Text(text = "暂时不可用", fontSize = 15.sp, color = Text1)
            Spacer(modifier = Modifier.height(10.dp))
            FallbackFeatureRow(
                title = "生成一页分析",
                desc = "分析服务恢复后可用",
                available = false,
                onClick = {},
            )
            Spacer(modifier = Modifier.height(8.dp))
            FallbackFeatureRow(
                title = "问与解释",
                desc = "依赖分析上下文，暂不可用",
                available = false,
                onClick = {},
            )

            Spacer(modifier = Modifier.height(24.dp))

            AppButton(
                text = "返回首页",
                type = AppButtonType.Primary,
                block = true,
                onClick = {
                    navController.navigate(Routes.HOME) {
                        popUpTo(Routes.HOME) { inclusive = true }
                    }
                },
            )

            Spacer(modifier = Modifier.height(16.dp))

            AppNotice(
                type = NoticeType.Info,
                text = "就医提示与已保存内容不依赖本服务；如症状加重，请直接前往医院。",
            )

            Spacer(modifier = Modifier.height(40.dp))
        }
    }
}

/** 功能行（可用 / 不可用） */
@Composable
private fun FallbackFeatureRow(
    title: String,
    desc: String,
    available: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (available) OkLight else NeutralLight)
            .clickable(enabled = available) { onClick() }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(20.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(if (available) Ok else Text3),
            contentAlignment = Alignment.Center,
        ) {
            if (available) {
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = null,
                    tint = Surface,
                    modifier = Modifier.size(12.dp),
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                fontSize = 14.sp,
                color = if (available) Text1 else Text3,
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = desc,
                fontSize = 11.sp,
                color = Text3,
            )
        }
        if (!available) {
            StatusTag(status = StatusKey.Offline)
        }
    }
}
