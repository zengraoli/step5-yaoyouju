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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
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
import com.yaoyouju.android.ui.theme.Border
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3
import kotlinx.coroutines.launch

/**
 * A11 记录今天（设计稿 docs/design/app/A11.png，宽度 375）
 *
 * 以生活任务组织记录；允许跳过；缺失不默认阴性；不复用昨日答案。
 *
 * 数据全部来自 server 接口：
 * - GET  /episodes/{id}/today       今天是否已记录（没有则空表单，不预填昨日答案）
 * - POST /episodes/{id}/today-logs  结构化记录（能坐多久 / 计划活动 / 睡眠 / 腿部变化 / 最担心）
 * - POST /episodes/{id}/events      「与昨天相比」与「今天做了什么」作为自述事件保存
 */
@Composable
fun TodayScreen(navController: NavHostController) {
    val episodesApi: EpisodesApi = NetworkModule.api()
    val scope = rememberCoroutineScope()

    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var alreadyRecorded by remember { mutableStateOf(false) }
    var toastText by remember { mutableStateOf("") }

    // 表单字段（全部可空：缺失显示尚未确认，不预填昨日答案）
    var sitMinutes by remember { mutableStateOf("") }
    var plannedActivity by remember { mutableStateOf("") }
    var sleepImpact by remember { mutableStateOf("") }
    var legChange by remember { mutableStateOf("") }
    var topWorry by remember { mutableStateOf("") }
    var compareYesterday by remember { mutableStateOf("") }
    var didToday by remember { mutableStateOf("") }

    // 选项（与 server 校验一致）
    val activityDoneOptions = listOf("完成", "部分完成", "未完成", "尚未确认")
    val legChangeOptions = listOf("有", "无", "尚未确认")
    val compareOptions = listOf("加重", "差不多", "减轻", "尚未确认")

    LaunchedEffect(Unit) {
        try {
            val episodes = handleResponse(episodesApi.list())
            val episode = episodes.firstOrNull()
            if (episode != null) {
                val today = handleResponse(episodesApi.today(episode.id))
                alreadyRecorded = today.recorded
                // 不预填昨日答案：表单保持为空（缺失即尚未确认）
            }
        } catch (e: Exception) {
            toastText = e.message ?: "今日状态加载失败"
        } finally {
            loading = false
        }
    }

    fun save(skipped: Boolean) {
        saving = true
        scope.launch {
            try {
                val episodes = handleResponse(episodesApi.list())
                val episode = episodes.firstOrNull()
                if (episode == null) {
                    toastText = "还没有病程，请先记录当前关键变化"
                    return@launch
                }
                val body = mutableMapOf<String, Any?>(
                    "skipped" to skipped,
                    "sit_minutes" to sitMinutes.toIntOrNull(),
                    "planned_activity_done" to plannedActivity.ifBlank { null },
                    "sleep_impact" to sleepImpact.toIntOrNull(),
                    "leg_change" to legChange.ifBlank { null },
                    "top_worry" to topWorry.ifBlank { null },
                )
                handleResponse(episodesApi.saveTodayLog(episode.id, body))
                // 「与昨天相比」与「今天做了什么」作为自述事件保存
                if (compareYesterday.isNotBlank()) {
                    handleResponse(
                        episodesApi.update(
                            episode.id,
                            mapOf(
                                "events" to listOf(
                                    mapOf(
                                        "event_type" to "症状",
                                        "label" to "与昨天相比",
                                        "detail" to compareYesterday,
                                        "verify_status" to "尚未确认",
                                        "source_type" to "自述",
                                    ),
                                ),
                            ),
                        ),
                    )
                }
                if (didToday.isNotBlank()) {
                    handleResponse(
                        episodesApi.update(
                            episode.id,
                            mapOf(
                                "events" to listOf(
                                    mapOf(
                                        "event_type" to "行动",
                                        "label" to "今天做了什么",
                                        "detail" to didToday,
                                        "verify_status" to "尚未确认",
                                        "source_type" to "自述",
                                    ),
                                ),
                            ),
                        ),
                    )
                }
                toastText = if (skipped) "已跳过今天（不会当作没有症状）" else "已保存今天的记录"
                navController.popBackStack()
            } catch (e: Exception) {
                toastText = e.message ?: "保存失败，请稍后重试"
            } finally {
                saving = false
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
                text = "记录今天",
                fontSize = 17.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            if (alreadyRecorded) {
                StatusTag(status = StatusKey.Confirmed)
            }
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Spacer(modifier = Modifier.height(12.dp))

            AppNotice(
                type = NoticeType.Info,
                text = "以生活任务记录，可以只填几项；没有填的显示「尚未确认」，不会默认阴性，也不会预填昨天的答案。",
            )

            if (alreadyRecorded) {
                Spacer(modifier = Modifier.height(12.dp))
                AppNotice(
                    type = NoticeType.Warn,
                    text = "今天已经记录过，再次保存会覆盖今天的结构化记录。",
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            // 能坐多久
            FormLabel(text = "今天能坐多久（分钟，可留空）")
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedTextField(
                value = sitMinutes,
                onValueChange = { sitMinutes = it },
                placeholder = { Text("如 30", color = Text3) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 计划活动完成情况
            FormLabel(text = "计划活动完成情况")
            Spacer(modifier = Modifier.height(8.dp))
            OptionRow(
                options = activityDoneOptions,
                selected = plannedActivity,
                onSelect = { plannedActivity = it },
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 睡眠影响（0-10）
            FormLabel(text = "睡眠受影响程度（0-10，可留空）")
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedTextField(
                value = sleepImpact,
                onValueChange = { sleepImpact = it },
                placeholder = { Text("如 4", color = Text3) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 腿部变化
            FormLabel(text = "腿部有没有新变化")
            Spacer(modifier = Modifier.height(8.dp))
            OptionRow(
                options = legChangeOptions,
                selected = legChange,
                onSelect = { legChange = it },
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 最担心的事
            FormLabel(text = "今天最担心的事（可留空）")
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedTextField(
                value = topWorry,
                onValueChange = { topWorry = it },
                placeholder = { Text("如：担心是不是腰间盘加重了", color = Text3) },
                minLines = 2,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 与昨天相比
            FormLabel(text = "与昨天相比")
            Spacer(modifier = Modifier.height(8.dp))
            OptionRow(
                options = compareOptions,
                selected = compareYesterday,
                onSelect = { compareYesterday = it },
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 今天做了什么
            FormLabel(text = "今天做了什么（自述事件）")
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedTextField(
                value = didToday,
                onValueChange = { didToday = it },
                placeholder = { Text("如：散步 20 分钟，坐了 1 小时", color = Text3) },
                minLines = 2,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(24.dp))

            AppButton(
                text = "保存今天的记录",
                type = AppButtonType.Primary,
                block = true,
                loading = saving,
                onClick = { save(false) },
            )

            Spacer(modifier = Modifier.height(12.dp))

            AppButton(
                text = "今天跳过",
                type = AppButtonType.Secondary,
                block = true,
                onClick = { save(true) },
            )

            Spacer(modifier = Modifier.height(16.dp))

            AppNotice(
                type = NoticeType.Info,
                text = "跳过只是今天不记录，不会写入「没有症状」的结论。",
            )

            Spacer(modifier = Modifier.height(40.dp))
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

/** 表单标签 */
@Composable
private fun FormLabel(text: String) {
    Text(text = text, fontSize = 13.sp, color = Text2)
}

/** 单选芯片行（可换行） */
@Composable
private fun OptionRow(
    options: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { option ->
                    val checked = selected == option
                    Row(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (checked) PrimaryLight else Surface)
                            .then(
                                if (checked) Modifier else Modifier.border(
                                    1.dp,
                                    Border,
                                    RoundedCornerShape(10.dp),
                                ),
                            )
                            .clickable { onSelect(option) }
                            .padding(vertical = 11.dp, horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(16.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (checked) Primary else Surface)
                                .then(
                                    if (checked) Modifier else Modifier.border(
                                        1.dp,
                                        Border,
                                        RoundedCornerShape(8.dp),
                                    ),
                                ),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = option,
                            fontSize = 12.sp,
                            color = if (checked) Primary else Text2,
                        )
                    }
                }
                if (row.size == 1) Spacer(modifier = Modifier.weight(1f))
            }
        }
    }
}
