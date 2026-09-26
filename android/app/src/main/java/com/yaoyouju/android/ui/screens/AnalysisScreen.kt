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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.yaoyouju.android.core.net.AnalysesApi
import com.yaoyouju.android.core.net.AnalysisSections
import com.yaoyouju.android.core.net.AnalysisView
import com.yaoyouju.android.core.net.EpisodesApi
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
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A07 一页理性分析（设计稿 docs/design/app/A07.png，宽度 375）
 *
 * 固定五段结构：① 当前确认的信息与来源 ② 这些信息能支持什么解释
 * ③ 仍缺哪些信息、哪些不能据此判断 ④ 建议向医生确认的问题与下一步 ⑤ 可选科普视频
 *
 * 产品红线：
 * - 每条解释都带来源（引用证据文档）；系统生成内容带版本号，不标为事实来源；
 * - 缺失即未知、不补写概率；「尚未确认」不会被当作「没有」；
 * - 顶部常驻「不作诊断」；页脚说明本页边界。
 */
@Composable
fun AnalysisScreen(
    navController: NavHostController,
    taskId: String = "",
    analysisId: String = "",
) {
    val analysesApi: AnalysesApi = NetworkModule.api()
    val episodesApi: EpisodesApi = NetworkModule.api()
    val scope = rememberCoroutineScope()

    var analysis by remember { mutableStateOf<AnalysisView?>(null) }
    var fallbackSections by remember { mutableStateOf<AnalysisSections?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var checkedQuestions by remember { mutableStateOf(setOf<Int>()) }
    var toastText by remember { mutableStateOf("") }

    // 轮询任务状态（2 秒）
    LaunchedEffect(taskId) {
        if (taskId.isNotBlank()) {
            while (true) {
                try {
                    val task = handleResponse(analysesApi.task(taskId))
                    when (task.status) {
                        "completed" -> {
                            analysis = task.analysis
                            loading = false
                            break
                        }
                        "failed" -> {
                            fallbackSections = task.fallback
                            errorText = task.reason ?: "分析生成失败，已切换为回退内容"
                            loading = false
                            break
                        }
                        else -> delay(2000)
                    }
                } catch (e: Exception) {
                    errorText = e.message ?: "查询分析状态失败"
                    loading = false
                    break
                }
            }
        } else if (analysisId.isNotBlank()) {
            // 直接查看已有分析
            try {
                analysis = handleResponse(analysesApi.detail(analysisId))
            } catch (e: Exception) {
                errorText = e.message ?: "分析加载失败"
            } finally {
                loading = false
            }
        } else {
            errorText = "缺少分析任务信息，请从核对信息页重新生成"
            loading = false
        }
    }

    LaunchedEffect(toastText) {
        if (toastText.isNotBlank()) {
            delay(2200)
            toastText = ""
        }
    }

    val sections = analysis?.sections ?: fallbackSections

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
                text = "一页理性分析",
                fontSize = 17.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            if (analysis != null) {
                StatusTag(status = StatusKey.Generated)
            }
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            // 顶部常驻「不作诊断」
            AppNotice(
                type = NoticeType.Error,
                text = "本页内容由系统生成，仅供参考，不作诊断，不提供处方或手术判断。",
            )

            if (loading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(200.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(text = "正在生成一页分析…", fontSize = 13.sp, color = Text3)
                }
            } else if (sections == null) {
                Spacer(modifier = Modifier.height(20.dp))
                AppNotice(
                    type = NoticeType.Error,
                    text = errorText.ifBlank { "分析内容暂不可用" },
                )
                Spacer(modifier = Modifier.height(16.dp))
                AppButton(
                    text = "返回重新生成",
                    type = AppButtonType.Secondary,
                    block = true,
                    onClick = { navController.popBackStack() },
                )
            } else {
                Spacer(modifier = Modifier.height(16.dp))

                // ① 当前确认的信息与来源
                SectionTitle(index = 1, title = "当前确认的信息与来源")
                if (sections.known.isEmpty()) {
                    Text(
                        text = "尚未确认的信息不会显示为「没有」。",
                        fontSize = 12.sp,
                        color = Text3,
                    )
                } else {
                    sections.known.forEach { item ->
                        AppCard(modifier = Modifier.padding(bottom = 8.dp)) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(text = item.text, fontSize = 13.sp, color = Text1)
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "来源：" + item.source,
                                    fontSize = 11.sp,
                                    color = Text3,
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // ② 这些信息能支持什么解释
                SectionTitle(index = 2, title = "这些信息能支持什么解释")
                if (sections.explain.isEmpty()) {
                    Text(
                        text = "信息不足，本段不给出解释。",
                        fontSize = 12.sp,
                        color = Text3,
                    )
                } else {
                    sections.explain.forEach { item ->
                        AppCard(modifier = Modifier.padding(bottom = 8.dp)) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(text = item.text, fontSize = 13.sp, color = Text1)
                                // 引用（可核实陈述）
                                item.citations.forEach { cite ->
                                    Spacer(modifier = Modifier.height(6.dp))
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(6.dp))
                                            .background(InfoLight)
                                            .padding(8.dp),
                                    ) {
                                        Text(
                                            text = "引用：" + cite.docTitle + " — " + cite.statement,
                                            fontSize = 11.sp,
                                            color = Info,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // ③ 仍缺哪些信息、哪些不能据此判断
                SectionTitle(index = 3, title = "仍缺哪些信息、哪些不能据此判断")
                if (sections.unknown.isEmpty()) {
                    Text(
                        text = "暂无缺失信息。",
                        fontSize = 12.sp,
                        color = Text3,
                    )
                } else {
                    AppCard {
                        Column(modifier = Modifier.padding(12.dp)) {
                            sections.unknown.forEach { unknown ->
                                Row(modifier = Modifier.padding(vertical = 4.dp)) {
                                    Text(text = "· ", fontSize = 13.sp, color = Text3)
                                    Text(text = unknown, fontSize = 13.sp, color = Text2)
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // ④ 建议向医生确认的问题与下一步
                SectionTitle(index = 4, title = "建议向医生确认的问题与下一步")
                sections.next.forEachIndexed { index, item ->
                    val checked = checkedQuestions.contains(index)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (checked) PrimaryLight else NeutralLight)
                            .clickable {
                                checkedQuestions = if (checked) {
                                    checkedQuestions - index
                                } else {
                                    checkedQuestions + index
                                }
                            }
                            .padding(vertical = 10.dp, horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(18.dp)
                                .clip(RoundedCornerShape(5.dp))
                                .background(if (checked) Primary else Surface),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (checked) {
                                Icon(
                                    imageVector = Icons.Filled.Check,
                                    contentDescription = null,
                                    tint = Surface,
                                    modifier = Modifier.size(11.dp),
                                )
                            }
                        }
                        Spacer(modifier = Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(text = item.text, fontSize = 13.sp, color = Text1)
                            if (item.type.isNotBlank()) {
                                Text(text = item.type, fontSize = 11.sp, color = Text3)
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }

                // ⑤ 可选科普视频
                if (sections.videos.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    SectionTitle(index = 5, title = "可选科普视频")
                    sections.videos.forEach { video ->
                        AppCard(modifier = Modifier.padding(bottom = 8.dp)) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(text = video.title, fontSize = 13.sp, color = Text1)
                                if (video.reason.isNotBlank()) {
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = "推荐理由：" + video.reason,
                                        fontSize = 11.sp,
                                        color = Text3,
                                    )
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // 版本信息（系统生成，不标为事实来源）
                AppNotice(
                    type = NoticeType.Info,
                    text = "系统生成 · 版本 v${sections.meta.version} · 模型 ${sections.meta.modelRelease}；生成内容不作为事实来源。",
                )

                Spacer(modifier = Modifier.height(20.dp))

                // 操作区
                AppButton(
                    text = "保存到病程",
                    type = AppButtonType.Primary,
                    block = true,
                    loading = saving,
                    onClick = {
                        saving = true
                        scope.launch {
                            try {
                                val episodes = handleResponse(episodesApi.list())
                                val episodeId = episodes.firstOrNull()?.id
                                if (episodeId != null) {
                                    handleResponse(
                                        episodesApi.update(
                                            episodeId,
                                            mapOf(
                                                "events" to listOf(
                                                    mapOf(
                                                        "event_type" to "行动",
                                                        "label" to "保存一页分析",
                                                        "detail" to "系统生成版本 v${sections.meta.version}",
                                                        "verify_status" to "尚未确认",
                                                        "source_type" to "系统生成",
                                                    ),
                                                ),
                                            ),
                                        ),
                                    )
                                }
                                toastText = "已保存到病程"
                            } catch (e: Exception) {
                                toastText = e.message ?: "保存失败，请稍后重试"
                            } finally {
                                saving = false
                            }
                        }
                    },
                )

                Spacer(modifier = Modifier.height(12.dp))

                AppButton(
                    text = "看原文对照",
                    type = AppButtonType.Secondary,
                    block = true,
                    onClick = { navController.navigate(Routes.REPORT_DIFF) },
                )

                Spacer(modifier = Modifier.height(12.dp))

                // 帮助类型反馈
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("看懂了", "知道下一步", "都不好").forEach { label ->
                        Text(
                            text = label,
                            fontSize = 12.sp,
                            color = Text2,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(NeutralLight)
                                .clickable { toastText = "已收到反馈：$label" }
                                .padding(horizontal = 12.dp, vertical = 7.dp),
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // 页脚边界说明
                Text(
                    text = sections.meta.disclaimer,
                    fontSize = 11.sp,
                    color = Text3,
                    lineHeight = 18.sp,
                )

                Spacer(modifier = Modifier.height(40.dp))
            }
        }
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

/** 段标题（① ② …） */
@Composable
private fun SectionTitle(index: Int, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(20.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Primary),
            contentAlignment = Alignment.Center,
        ) {
            Text(text = "$index", fontSize = 11.sp, color = Surface)
        }
        Spacer(modifier = Modifier.width(8.dp))
        Text(text = title, fontSize = 15.sp, color = Text1)
    }
    Spacer(modifier = Modifier.height(8.dp))
}
