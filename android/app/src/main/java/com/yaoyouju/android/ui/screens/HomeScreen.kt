package com.yaoyouju.android.ui.screens

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.CircularProgressIndicator
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
import com.yaoyouju.android.core.net.AnalysisView
import com.yaoyouju.android.core.net.ApiException
import com.yaoyouju.android.core.net.CreateAnalysisRequest
import com.yaoyouju.android.core.net.AnalysesApi
import com.yaoyouju.android.core.net.ContentListItem
import com.yaoyouju.android.core.net.ContentsApi
import com.yaoyouju.android.core.net.CareEventView
import com.yaoyouju.android.core.net.UpdateCareEventRequest
import com.yaoyouju.android.core.net.EpisodeDetail
import com.yaoyouju.android.core.net.EpisodeItem
import com.yaoyouju.android.core.net.EpisodesApi
import com.yaoyouju.android.core.net.FollowupApi
import com.yaoyouju.android.core.net.FollowupSummaryView
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.TodayStatus
import com.yaoyouju.android.core.net.handleResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
import com.yaoyouju.android.ui.components.AppCard
import com.yaoyouju.android.ui.components.AppNotice
import com.yaoyouju.android.ui.components.EmergencyEntry
import com.yaoyouju.android.ui.components.NoticeType
import com.yaoyouju.android.ui.components.StatusKey
import com.yaoyouju.android.ui.components.StatusTag
import com.yaoyouju.android.ui.navigation.Routes
import com.yaoyouju.android.ui.theme.NeutralLight
import com.yaoyouju.android.ui.theme.Error
import com.yaoyouju.android.ui.theme.ErrorLight
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3
import com.yaoyouju.android.ui.theme.WarnLight

/**
 * A14 首页 · 当前情况（设计稿 docs/design/app/A14.png，宽度 375，主 Tab）
 *
 * 结构：自定义顶栏（标题 + 病程摘要 + 通知 / 头像）→ 待确认项卡片（优先）→
 *       最新一页分析摘要 → 快捷入口 2×2 → 复诊倒计时 → 为你推荐 → 就医提示条。
 *
 * 产品红线：
 * - 缺失信息显示「尚未确认」，不默认阴性 / 无；
 * - 就医提示入口在页面内可达，不被登录阻断；
 * - 社区不占首屏（本页不放社区入口）；
 * - 系统生成内容带「系统生成」标记，不标为事实来源。
 */
@Composable
fun HomeScreen(navController: NavHostController) {
    val episodesApi: EpisodesApi = NetworkModule.api()
    val contentsApi: ContentsApi = NetworkModule.api()
    val analysesApi: AnalysesApi = NetworkModule.api()
    val followupApi: FollowupApi = NetworkModule.api()

    var loading by remember { mutableStateOf(true) }
    var toastText by remember { mutableStateOf("") }
    var episode by remember { mutableStateOf<EpisodeDetail?>(null) }
    var pendingEvents by remember { mutableStateOf<List<CareEventView>>(emptyList()) }
    var todayRecorded by remember { mutableStateOf<Boolean?>(null) }
    var latestAnalysis by remember { mutableStateOf<AnalysisView?>(null) }
    var latestFollowup by remember { mutableStateOf<FollowupSummaryView?>(null) }
    var recommendations by remember { mutableStateOf<List<ContentListItem>>(emptyList()) }
    var creatingAnalysis by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    fun loadData() {
        loading = true
        // 数据加载在协程中执行
        loadHomeData(
            scope = scope,
            episodesApi = episodesApi,
            contentsApi = contentsApi,
            analysesApi = analysesApi,
            followupApi = followupApi,
            onResult = { result ->
                episode = result.episode
                pendingEvents = result.pendingEvents
                todayRecorded = result.todayRecorded
                latestAnalysis = result.latestAnalysis
                latestFollowup = result.latestFollowup
                recommendations = result.recommendations
                loading = false
            },
            onError = { message ->
                toastText = message
                loading = false
            },
            onNetworkError = {
                loading = false
                // 断网时进服务不可用页，不要把「新用户引导」当成没有病程（第七轮第 17、21 条）
                navController.openFallbackOnNetworkError(
                    ApiException(0, "网络连接失败，请检查网络后重试", null, network = true),
                )
            },
        )
    }

    LaunchedEffect(Unit) {
        loadData()
    }

    LaunchedEffect(toastText) {
        if (toastText.isNotBlank()) {
            kotlinx.coroutines.delay(2200)
            toastText = ""
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(Surface)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            // 自定义顶栏
            HomeTopBar(navController)

            if (loading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(240.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = Primary)
                }
            } else {
                Column(modifier = Modifier.padding(horizontal = 20.dp)) {
                    // 新用户：还没有病程时先引导「现在确认当前关键变化」（A02 只在时间线为空时有入口）
                    if (episode == null) {
                        Spacer(modifier = Modifier.height(16.dp))
                        AppNotice(
                            type = NoticeType.Info,
                            text = "先确认当前关键变化（4 个低负担问题），或直接从「记录今天」开始。没有回答的问题会记录为「尚未确认」，不会默认阴性或无。",
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        AppButton(
                            text = "现在确认当前关键变化",
                            type = AppButtonType.Primary,
                            block = true,
                            onClick = { navController.navigate(Routes.CHANGE) },
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        AppButton(
                            text = "先记录今天",
                            type = AppButtonType.Secondary,
                            block = true,
                            onClick = { navController.navigate(Routes.TODAY) },
                        )
                    }

                    // 待确认项卡片（优先）
                    if (pendingEvents.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(16.dp))
                        PendingEventsCard(
                            events = pendingEvents,
                            onConfirm = { event ->
                                val epId = episode?.id
                                if (epId != null) {
                                confirmEventInline(
                                    scope = scope,
                                    episodesApi = episodesApi,
                                    episodeId = epId,
                                    event = event,
                                    onDone = { loadData() },
                                    onError = { toastText = it },
                                )
                                }
                            },
                            onOpenTimeline = { navController.navigate(Routes.TIMELINE) },
                        )
                    }

                    // 最新一页分析摘要
                    Spacer(modifier = Modifier.height(16.dp))
                    LatestAnalysisCard(
                        analysis = latestAnalysis,
                        episodeTitle = episode?.title ?: "我的病程",
                        creating = creatingAnalysis,
                        onGenerate = {
                            val episodeId = episode?.id
                            if (episodeId == null) {
                                // 新用户：先确认当前关键变化（A02），再生成一页分析
                                navController.navigate(Routes.CHANGE)
                            } else {
                                creatingAnalysis = true
                                createAnalysisInline(
                                    scope = scope,
                                    analysesApi = analysesApi,
                                    episodeId = episodeId,
                                    onDone = { taskId ->
                                        creatingAnalysis = false
                                        // 带上任务 ID 进入分析页：轮询到完成后再显示，不会先闪旧版本（第七轮第 23 条）
                                        navController.navigate(Routes.ANALYSIS + "?taskId=" + taskId)
                                        loadData()
                                    },
                                    onError = { message ->
                                        creatingAnalysis = false
                                        toastText = message
                                    },
                                    onSafety = { signals, stop ->
                                        // 命中红旗：立即进就医提示页，不被「提交任务」阻断（第七轮第 18 条）
                                        creatingAnalysis = false
                                        navController.navigate(
                                            Routes.EMERGENCY + "?signals=" + Uri.encode(signals) + "&stop=" + stop,
                                        )
                                    },
                                )
                            }
                        },
                        onOpen = { navController.navigate(Routes.ANALYSIS) },
                    )

                    // 快捷入口 2×2
                    Spacer(modifier = Modifier.height(16.dp))
                    QuickEntries(
                        onReportInput = { navController.navigate(Routes.REPORT_INPUT) },
                        onQa = { navController.navigate(Routes.QA) },
                        onToday = { navController.navigate(Routes.TODAY) },
                        onFollowup = { navController.navigate(Routes.FOLLOWUP) },
                    )

                    // 选择主要困惑（A04）：按需调整解释方式
                    Spacer(modifier = Modifier.height(16.dp))
                    AppButton(
                        text = "选择主要困惑，调整解释方式",
                        type = AppButtonType.Soft,
                        block = true,
                        onClick = { navController.navigate(Routes.CONFUSION) },
                    )

                    // 记录今天入口（今天未记录时显示）
                    if (todayRecorded == false) {
                        Spacer(modifier = Modifier.height(16.dp))
                        AppNotice(
                            type = NoticeType.Warn,
                            text = "今天还没有记录症状变化，记录后可保留来源与时间。",
                        )
                    }

                    // 复诊倒计时
                    Spacer(modifier = Modifier.height(16.dp))
                    FollowupCountdownCard(followup = latestFollowup)

                    // 为你推荐
                    if (recommendations.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(16.dp))
                        RecommendationsCard(
                            items = recommendations,
                            onOpenContent = { id -> navController.navigate(Routes.CONTENT_DETAIL + "?contentId=" + id) },
                        )
                    }

                    Spacer(modifier = Modifier.height(20.dp))
                    EmergencyEntry(onClick = { navController.navigate(Routes.EMERGENCY) })
                    Spacer(modifier = Modifier.height(24.dp))
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
}

/** 顶栏：标题 + 病程摘要 + 通知/头像 */
@Composable
private fun HomeTopBar(navController: NavHostController) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Surface)
            .statusBarsPadding()
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = "当前情况", fontSize = 20.sp, color = Text1)
            Spacer(modifier = Modifier.height(2.dp))
            Text(text = "腰痛理解与复诊助手", fontSize = 11.sp, color = Text3)
        }
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(PrimaryLight)
                .clickable { navController.navigate(Routes.MINE) },
            contentAlignment = Alignment.Center,
        ) {
            Text(text = "U", fontSize = 14.sp, color = Primary)
        }
        Spacer(modifier = Modifier.width(10.dp))
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(18.dp))
                .clickable { navController.navigate(Routes.FEEDBACK) },
            contentAlignment = Alignment.Center,
        ) {
            // 设计稿 A14：铃形图标（本地 Material 图标，不加载外部资源）
            Icon(
                imageVector = Icons.Filled.Notifications,
                contentDescription = "通知",
                tint = Text2,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

/** 待确认项卡片（优先） */
@Composable
private fun PendingEventsCard(
    events: List<CareEventView>,
    onConfirm: (CareEventView) -> Unit,
    onOpenTimeline: () -> Unit,
) {
    AppCard {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "待确认项（优先）",
                    fontSize = 15.sp,
                    color = Text1,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "查看全部",
                    fontSize = 12.sp,
                    color = Primary,
                    modifier = Modifier.clickable { onOpenTimeline() },
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "以下信息尚未由你确认，不会默认阴性或无",
                fontSize = 11.sp,
                color = Text3,
            )
            Spacer(modifier = Modifier.height(12.dp))
            events.take(3).forEach { event ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = event.rawText ?: "${event.eventType}记录（无原文）",
                            fontSize = 14.sp,
                            color = Text1,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = "来源：" + event.sourceType + " · " + event.verifyStatus,
                            fontSize = 11.sp,
                            color = Text3,
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    StatusTag(status = StatusKey.Unconfirmed)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "确认",
                        fontSize = 12.sp,
                        color = Primary,
                        modifier = Modifier.clickable { onConfirm(event) },
                    )
                }
            }
        }
    }
}

/** 最新一页分析摘要 */
@Composable
private fun LatestAnalysisCard(
    analysis: AnalysisView?,
    episodeTitle: String,
    creating: Boolean,
    onGenerate: () -> Unit,
    onOpen: () -> Unit,
) {
    AppCard {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "最新一页分析摘要",
                    fontSize = 15.sp,
                    color = Text1,
                    modifier = Modifier.weight(1f),
                )
                StatusTag(status = StatusKey.Generated)
            }
            Spacer(modifier = Modifier.height(8.dp))
            if (analysis == null) {
                Text(
                    text = "还没有生成过一页分析。可基于「$episodeTitle」的记录整理成五段结构。",
                    fontSize = 12.sp,
                    color = Text2,
                )
                Spacer(modifier = Modifier.height(12.dp))
                AppButton(
                    text = "生成一页分析",
                    type = AppButtonType.Secondary,
                    block = true,
                    loading = creating,
                    onClick = onGenerate,
                )
            } else {
                Text(
                    text = "由你的病程记录整理；一页分析含完整五段结构与来源，系统生成内容不作为事实来源。",
                    fontSize = 12.sp,
                    color = Text2,
                )
                Spacer(modifier = Modifier.height(12.dp))
                AppButton(
                    text = "查看一页分析",
                    type = AppButtonType.Secondary,
                    block = true,
                    onClick = onOpen,
                )
            }
        }
    }
}

/** 快捷入口 2×2 */
@Composable
private fun QuickEntries(
    onReportInput: () -> Unit,
    onQa: () -> Unit,
    onToday: () -> Unit,
    onFollowup: () -> Unit,
) {
    // 设计稿 A14 的四个快捷入口（第七轮第 34 条：不再是「病程时间线」）
    val entries = listOf(
        Triple("记录今天", "约 1 分钟", onToday),
        Triple("录入报告", "粘贴文字", onReportInput),
        Triple("问与解释", "基于当前上下文", onQa),
        Triple("复诊摘要", "待确认问题自动带入", onFollowup),
    )
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        entries.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { (title, desc, onClick) ->
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(12.dp))
                            .background(NeutralLight)
                            .clickable { onClick() }
                            .padding(vertical = 14.dp, horizontal = 12.dp),
                    ) {
                        Text(text = title, fontSize = 13.sp, color = Text1)
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(text = desc, fontSize = 11.sp, color = Text3)
                    }
                }
                if (row.size == 1) Spacer(modifier = Modifier.weight(1f))
            }
        }
    }
}

/** 复诊倒计时 */
@Composable
private fun FollowupCountdownCard(followup: FollowupSummaryView?) {
    AppCard {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "复诊倒计时", fontSize = 15.sp, color = Text1)
            Spacer(modifier = Modifier.height(8.dp))
            if (followup == null) {
                Text(
                    text = "还没有复诊摘要，生成后可显示倒计时与待确认问题。",
                    fontSize = 12.sp,
                    color = Text2,
                )
            } else {
                Text(
                    text = "最近摘要：已生成 " + followup.content.sections.size + " 段",
                    fontSize = 12.sp,
                    color = Text2,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** 为你推荐（含服务端推荐理由） */
@Composable
private fun RecommendationsCard(
    items: List<ContentListItem>,
    onOpenContent: (String) -> Unit,
) {
    AppCard {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "为你推荐", fontSize = 15.sp, color = Text1)
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "来自审核内容库，含服务端推荐理由",
                fontSize = 11.sp,
                color = Text3,
            )
            Spacer(modifier = Modifier.height(12.dp))
            items.take(2).forEach { item ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpenContent(item.id) }
                        .padding(vertical = 6.dp),
                ) {
                    Text(
                        text = item.title,
                        fontSize = 13.sp,
                        color = Text1,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (!item.recommendReason.isNullOrBlank()) {
                        Text(
                            text = "推荐理由：" + item.recommendReason,
                            fontSize = 11.sp,
                            color = Text3,
                        )
                    }
                }
            }
        }
    }
}

/** 首页数据加载结果 */
class HomeData(
    val episode: EpisodeDetail?,
    val pendingEvents: List<CareEventView>,
    val todayRecorded: Boolean?,
    val latestAnalysis: AnalysisView?,
    val latestFollowup: FollowupSummaryView?,
    val recommendations: List<ContentListItem>,
)

/** 加载首页数据（在协程中调用） */
private fun loadHomeData(
    scope: kotlinx.coroutines.CoroutineScope,
    episodesApi: EpisodesApi,
    contentsApi: ContentsApi,
    analysesApi: AnalysesApi,
    followupApi: FollowupApi,
    onResult: (HomeData) -> Unit,
    onError: (String) -> Unit,
    /** 网络层异常：进入服务不可用页（第七轮第 17、21 条） */
    onNetworkError: () -> Unit = {},
) {
    scope.launch {
        try {
            val episodes: List<EpisodeItem> = handleResponse(episodesApi.list())
            val first = episodes.firstOrNull()
            if (first == null) {
                onResult(HomeData(null, emptyList(), null, null, null, emptyList()))
                return@launch
            }
            val episodeDetail: EpisodeDetail = handleResponse(episodesApi.detail(first.id))
            val pending = episodeDetail?.events?.filter { it.verifyStatus == "尚未确认" || it.verifyStatus == "有冲突" } ?: emptyList()

            val todayRecorded = try {
                handleResponse(episodesApi.today(first.id)).logged
            } catch (_: Exception) {
                null
            }

            val latestAnalysis = try {
                episodeDetail?.latestAnalysisId?.let { id ->
                    handleResponse(analysesApi.detail(id))
                }
            } catch (_: Exception) {
                null
            }

            val latestFollowup = try {
                handleResponse(followupApi.latest(first.id))
            } catch (_: Exception) {
                null
            }

            val recommendations = try {
                handleResponse(contentsApi.list()).take(2)
            } catch (_: Exception) {
                emptyList()
            }

            onResult(
                HomeData(
                    episode = episodeDetail,
                    pendingEvents = pending,
                    todayRecorded = todayRecorded,
                    latestAnalysis = latestAnalysis,
                    latestFollowup = latestFollowup,
                    recommendations = recommendations,
                ),
            )
        } catch (e: Exception) {
            if (e.isNetworkError()) onNetworkError() else onError(e.userMessage())
        }
    }
}

/** 内联确认事件 */
private fun confirmEventInline(
    scope: kotlinx.coroutines.CoroutineScope,
    episodesApi: EpisodesApi,
    episodeId: String,
    event: CareEventView,
    onDone: () -> Unit,
    onError: (String) -> Unit,
) {
    scope.launch {
        try {
            handleResponse(
                episodesApi.updateEvent(
                    episodeId,
                    event.id,
                    UpdateCareEventRequest(verifyStatus = "已确认"),
                ),
            )
            onDone()
        } catch (e: Exception) {
            onError(e.userMessage())
        }
    }
}

/** 生成一页分析 */
private fun createAnalysisInline(
    scope: kotlinx.coroutines.CoroutineScope,
    analysesApi: AnalysesApi,
    episodeId: String,
    onDone: (String) -> Unit,
    onError: (String) -> Unit,
    /** 命中红旗：进就医提示页，不被「提交任务」流程阻断（第七轮第 18 条） */
    onSafety: (String, Boolean) -> Unit = { _, _ -> },
) {
    scope.launch {
        try {
            val created = handleResponse(analysesApi.create(CreateAnalysisRequest(episodeId = episodeId)))
            onDone(created.taskId)
        } catch (e: Exception) {
            val notice = safetyNoticeOf(e)
            if (notice != null) onSafety(notice.first, notice.second) else onError(e.userMessage())
        }
    }
}

/** rememberCoroutineScope 简写 */
@Composable
private fun rememberCoroutineScope(): kotlinx.coroutines.CoroutineScope =
    androidx.compose.runtime.rememberCoroutineScope()
