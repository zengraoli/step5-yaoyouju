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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.yaoyouju.android.core.net.AnalysesApi
import com.yaoyouju.android.core.net.ApiException
import com.yaoyouju.android.core.net.EpisodesApi
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.ReportsApi
import com.yaoyouju.android.core.net.StructuredItem
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
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3
import kotlinx.coroutines.launch

/**
 * A06 核对结构化信息（设计稿 docs/design/app/A06.png，宽度 375，第 4/4 步）
 *
 * 来源、时间、核实状态可见；冲突项必须由用户确认；缺失不默认阴性。
 *
 * 数据全部来自 server 接口：
 * - GET  /episodes/{id}/structured  整理后的结构化信息（来源 / 时间 / 核实状态 / 术语）
 * - PATCH /episodes/{id}/events/{id} 冲突项确认（verify_status = 已确认）
 * - POST /analyses                  确认无误后生成一页分析（命中红旗走就医提示分支）
 */
@Composable
fun ReportVerifyScreen(navController: NavHostController) {
    val reportsApi: ReportsApi = NetworkModule.api()
    val episodesApi: EpisodesApi = NetworkModule.api()
    val analysesApi: AnalysesApi = NetworkModule.api()
    val scope = rememberCoroutineScope()

    var loading by remember { mutableStateOf(true) }
    var items by remember { mutableStateOf<List<StructuredItem>>(emptyList()) }
    var summary by remember { mutableStateOf<com.yaoyouju.android.core.net.StructuredSummary?>(null) }
    var submitting by remember { mutableStateOf(false) }
    var toastText by remember { mutableStateOf("") }

    // 主要困惑键 → 展示文案（A04 选择，本地保存）
    val confusionLabels = mapOf(
        "report" to "报告术语",
        "course" to "病程变化",
        "followup" to "复诊准备",
        "life" to "生活影响",
    )

    fun load() {
        loading = true
        scope.launch {
            try {
                val episodes: List<com.yaoyouju.android.core.net.EpisodeItem> = handleResponse(episodesApi.list())
                val episodeId = episodes.firstOrNull()?.id
                if (episodeId != null) {
                    val structured = handleResponse(reportsApi.structured(episodeId))
                    items = structured.items
                    summary = structured.summary
                }
            } catch (e: Exception) {
                toastText = e.message ?: "结构化信息加载失败"
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    fun confirmEvent(eventId: String) {
        scope.launch {
            try {
                val episodes: List<com.yaoyouju.android.core.net.EpisodeItem> = handleResponse(episodesApi.list())
                val episodeId = episodes.firstOrNull()?.id ?: return@launch
                handleResponse(
                    episodesApi.updateEvent(
                        episodeId,
                        eventId,
                        mapOf("verify_status" to "已确认"),
                    ),
                )
                load()
            } catch (e: Exception) {
                toastText = e.message ?: "确认失败，请稍后重试"
            }
        }
    }

    fun generateAnalysis() {
        submitting = true
        scope.launch {
            try {
                val episodes: List<com.yaoyouju.android.core.net.EpisodeItem> = handleResponse(episodesApi.list())
                val episodeId = episodes.firstOrNull()?.id ?: return@launch
                try {
                    handleResponse(analysesApi.create(mapOf("episode_id" to episodeId)))
                    navController.navigate(Routes.ANALYSIS)
                } catch (e: Exception) {
                    val error = e as? ApiException
                    if (error != null && (error.code == 40910 || error.code == 40911)) {
                        // 命中红旗：走就医提示分支
                        navController.navigate(Routes.EMERGENCY + "?stop=1")
                        return@launch
                    }
                    throw e
                }
            } catch (e: Exception) {
                toastText = e.message ?: "生成分析失败，请稍后重试"
            } finally {
                submitting = false
            }
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
                text = "核对结构化信息",
                fontSize = 17.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            Text(text = "第 4/4 步", fontSize = 12.sp, color = Text3)
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "来源、时间、核实状态都列在下面。冲突项需要你确认后才会进入一页分析；没有回答的问题显示「尚未确认」，不会默认阴性。",
                fontSize = 13.sp,
                color = Text2,
                lineHeight = 20.sp,
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 汇总
            val s = summary
            if (s != null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(com.yaoyouju.android.ui.theme.NeutralLight)
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    SummaryChip(label = "共 ${s.total} 条", tone = Text2)
                    SummaryChip(label = "已确认 ${s.confirmed}", tone = Primary)
                    SummaryChip(label = "尚未确认 ${s.unconfirmed}", tone = Text3)
                    if (s.conflict > 0) {
                        SummaryChip(label = "有冲突 ${s.conflict}", tone = Error)
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            if (loading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(text = "加载中…", fontSize = 13.sp, color = Text3)
                }
            } else if (items.isEmpty()) {
                AppNotice(
                    type = NoticeType.Info,
                    text = "还没有可核对的结构化信息，可直接生成一页分析。",
                )
            } else {
                items.forEach { item ->
                    StructuredItemCard(
                        item = item,
                        onConfirm = { confirmEvent(item.careEventId) },
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // 主要困惑提醒（A04 选择影响解释呈现）
            AppNotice(
                type = NoticeType.Info,
                text = "解释会按你在 A04 选择的困惑（${confusionLabels.values.joinToString(" / ")}）调整重点与长度，不构成诊断。",
            )

            Spacer(modifier = Modifier.height(24.dp))

            AppButton(
                text = "确认无误，生成一页分析",
                type = AppButtonType.Primary,
                block = true,
                loading = submitting,
                onClick = { generateAnalysis() },
            )

            Spacer(modifier = Modifier.height(12.dp))

            AppButton(
                text = "先看原文对照",
                type = AppButtonType.Secondary,
                block = true,
                onClick = { navController.navigate(Routes.REPORT_DIFF) },
            )

            Spacer(modifier = Modifier.height(40.dp))
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

/** 汇总小芯片 */
@Composable
private fun SummaryChip(label: String, tone: androidx.compose.ui.graphics.Color) {
    Text(
        text = label,
        fontSize = 11.sp,
        color = tone,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(Surface)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

/** 结构化条目卡片：来源 / 时间 / 核实状态 / 术语 */
@Composable
private fun StructuredItemCard(
    item: StructuredItem,
    onConfirm: () -> Unit,
) {
    AppCard(
        background = if (item.needsConfirm) ErrorLight else Surface,
        borderColor = if (item.needsConfirm) Error else com.yaoyouju.android.ui.theme.Border,
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = item.eventType,
                    fontSize = 14.sp,
                    color = Text1,
                    modifier = Modifier.weight(1f),
                )
                StatusTag(
                    status = when (item.verifyStatus) {
                        "已确认" -> StatusKey.Confirmed
                        "有冲突" -> StatusKey.Conflict
                        "已核实" -> StatusKey.Reviewed
                        else -> StatusKey.Unconfirmed
                    },
                )
            }
            Spacer(modifier = Modifier.height(6.dp))
            // 来源类型
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "来源：" + item.sourceType,
                    fontSize = 11.sp,
                    color = Text3,
                    modifier = Modifier.weight(1f),
                )
                // 时间
                Text(
                    text = item.occurredAt?.take(10) ?: "时间尚未确认",
                    fontSize = 11.sp,
                    color = Text3,
                )
            }
            // 原文摘要
            if (!item.rawText.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = item.rawText,
                    fontSize = 12.sp,
                    color = Text2,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            // 术语
            val terms = item.report?.extractedTerms ?: emptyList()
            if (terms.isNotEmpty()) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "术语：" + terms.joinToString("、") { it.term },
                    fontSize = 11.sp,
                    color = Text3,
                )
            }
            // 冲突项需确认
            if (item.needsConfirm) {
                Spacer(modifier = Modifier.height(10.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Surface)
                        .clickable { onConfirm() }
                        .padding(vertical = 8.dp, horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = null,
                        tint = Primary,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "这条信息有冲突，点击确认以你的记录为准",
                        fontSize = 12.sp,
                        color = Text1,
                    )
                }
            }
        }
    }
}
