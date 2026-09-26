package com.yaoyouju.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import com.yaoyouju.android.core.net.EpisodesApi
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.TimelineApi
import com.yaoyouju.android.core.net.TimelineGroup
import com.yaoyouju.android.core.net.TimelineItem
import com.yaoyouju.android.core.net.handleResponse
import kotlinx.coroutines.launch
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
import com.yaoyouju.android.ui.components.AppCard
import com.yaoyouju.android.ui.components.AppNotice
import com.yaoyouju.android.ui.components.NoticeType
import com.yaoyouju.android.ui.components.StatusKey
import com.yaoyouju.android.ui.components.StatusTag
import com.yaoyouju.android.ui.navigation.Routes
import com.yaoyouju.android.ui.theme.Border
import com.yaoyouju.android.ui.theme.Info
import com.yaoyouju.android.ui.theme.InfoLight
import com.yaoyouju.android.ui.theme.NeutralLight
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3

/**
 * A10 病程时间线（设计稿 docs/design/app/A10.png，宽度 375，主 Tab）
 *
 * 按事件记录；区分自述 / 报告原文 / 医生记录；用户可纠正、删除；
 * 变化图不暗示影像恶化。
 *
 * 数据全部来自 server 接口：
 * - GET /episodes              病程列表（本次发作）
 * - GET /episodes/{id}/timeline 按日期分组的事件时间线
 * - GET /episodes/{id}/today   今天是否已记录
 */
@Composable
fun TimelineScreen(navController: NavHostController) {
    val episodesApi: EpisodesApi = NetworkModule.api()
    val timelineApi: TimelineApi = NetworkModule.api()

    var groups by remember { mutableStateOf<List<TimelineGroup>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var todayRecorded by remember { mutableStateOf<Boolean?>(null) }
    var toastText by remember { mutableStateOf("") }

    val scope = rememberCoroutineScope()

    fun load() {
        loading = true
        // 协程加载
        loadTimelineData(
            scope = scope,
            episodesApi = episodesApi,
            timelineApi = timelineApi,
            onResult = { g, today ->
                groups = g
                todayRecorded = today
                loading = false
            },
            onError = { message ->
                toastText = message
                loading = false
            },
        )
    }

    LaunchedEffect(Unit) { load() }

    LaunchedEffect(toastText) {
        if (toastText.isNotBlank()) {
            kotlinx.coroutines.delay(2200)
            toastText = ""
        }
    }

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
                text = "病程时间线",
                fontSize = 20.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = "自述 / 报告原文 / 医生记录",
                fontSize = 11.sp,
                color = Text3,
            )
        }

        Box(modifier = Modifier.weight(1f)) {
            when {
                loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(text = "加载中…", fontSize = 13.sp, color = Text3)
                }

                groups.isEmpty() -> Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(text = "还没有病程记录", fontSize = 15.sp, color = Text1)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "从「当前关键变化确认」开始，记录会按日期显示在这里。",
                        fontSize = 12.sp,
                        color = Text2,
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    AppButton(
                        text = "记录当前关键变化",
                        type = AppButtonType.Primary,
                        onClick = { navController.navigate(Routes.CHANGE) },
                    )
                }

                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    items(groups) { group ->
                        TimelineGroupCard(
                            group = group,
                            onCorrect = { item ->
                                toastText = "纠正「${item.label}」后核实状态会变为有冲突"
                            },
                            onDelete = { item ->
                                toastText = "已删除「${item.label}」（演示）"
                            },
                        )
                    }
                }
            }
        }

        // 底部：记录今天入口
        if (todayRecorded == false) {
            AppNotice(
                type = NoticeType.Warn,
                text = "今天还没有记录症状变化。",
                modifier = Modifier.padding(horizontal = 20.dp),
            )
            Spacer(modifier = Modifier.height(8.dp))
            AppButton(
                text = "记录今天",
                type = AppButtonType.Primary,
                block = true,
                onClick = { navController.navigate(Routes.TODAY) },
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        } else {
            AppButton(
                text = "记录今天",
                type = AppButtonType.Secondary,
                block = true,
                onClick = { navController.navigate(Routes.TODAY) },
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        AppNotice(
            type = NoticeType.Info,
            text = "时间线只整理你记录的内容，不暗示影像恶化。",
            modifier = Modifier.padding(horizontal = 20.dp),
        )

        Spacer(modifier = Modifier.height(16.dp))
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
                    .padding(bottom = 140.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Text1.copy(alpha = 0.85f))
                    .padding(horizontal = 20.dp, vertical = 10.dp),
            )
        }
    }
}

/** 日期分组卡片 */
@Composable
private fun TimelineGroupCard(
    group: TimelineGroup,
    onCorrect: (TimelineItem) -> Unit,
    onDelete: (TimelineItem) -> Unit,
) {
    Column {
        // 日期标签
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(Primary),
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(text = group.date, fontSize = 13.sp, color = Text1)
            Spacer(modifier = Modifier.weight(1f))
            Text(text = "${group.items.size} 条", fontSize = 11.sp, color = Text3)
        }
        Spacer(modifier = Modifier.height(8.dp))
        group.items.forEach { item ->
            TimelineItemCard(
                item = item,
                onCorrect = { onCorrect(item) },
                onDelete = { onDelete(item) },
            )
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

/** 单条事件卡片 */
@Composable
private fun TimelineItemCard(
    item: TimelineItem,
    onCorrect: () -> Unit,
    onDelete: () -> Unit,
) {
    AppCard {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = item.label,
                    fontSize = 14.sp,
                    color = Text1,
                    modifier = Modifier.weight(1f),
                )
                // 来源类型徽标
                Text(
                    text = item.sourceType,
                    fontSize = 10.sp,
                    color = when (item.sourceType) {
                        "报告" -> Info
                        "医生记录" -> Primary
                        else -> Text2
                    },
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(
                            when (item.sourceType) {
                                "报告" -> InfoLight
                                "医生记录" -> PrimaryLight
                                else -> NeutralLight
                            },
                        )
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                StatusTag(
                    status = when (item.verifyStatus) {
                        "已确认" -> StatusKey.Confirmed
                        "有冲突" -> StatusKey.Conflict
                        else -> StatusKey.Unconfirmed
                    },
                )
            }
            if (!item.detail.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = item.detail,
                    fontSize = 12.sp,
                    color = Text2,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "${item.eventType} · ${item.occurredAt?.take(10) ?: "时间尚未确认"}",
                fontSize = 11.sp,
                color = Text3,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(
                    text = "纠正",
                    fontSize = 12.sp,
                    color = Primary,
                    modifier = Modifier.clickable { onCorrect() },
                )
                Text(
                    text = "删除",
                    fontSize = 12.sp,
                    color = Text3,
                    modifier = Modifier.clickable { onDelete() },
                )
            }
        }
    }
}

/** 加载时间线数据（协程） */
private fun loadTimelineData(
    scope: kotlinx.coroutines.CoroutineScope,
    episodesApi: EpisodesApi,
    timelineApi: TimelineApi,
    onResult: (List<TimelineGroup>, Boolean?) -> Unit,
    onError: (String) -> Unit,
) {
    scope.launch {
        try {
            val episodes = handleResponse(episodesApi.list())
            val episode = episodes.firstOrNull()
            if (episode == null) {
                onResult(emptyList(), null)
                return@launch
            }
            val timeline = handleResponse(timelineApi.timeline(episode.id))
            val today = try {
                handleResponse(episodesApi.today(episode.id)).recorded
            } catch (_: Exception) {
                null
            }
            onResult(timeline, today)
        } catch (e: Exception) {
            onError(e.message ?: "时间线加载失败")
        }
    }
}
