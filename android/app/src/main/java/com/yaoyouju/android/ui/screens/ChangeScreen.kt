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
import com.yaoyouju.android.core.net.handleResponse
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
import com.yaoyouju.android.ui.components.AppChip
import com.yaoyouju.android.ui.components.AppNotice
import com.yaoyouju.android.ui.components.NoticeType
import com.yaoyouju.android.ui.navigation.Routes
import com.yaoyouju.android.ui.theme.Error
import com.yaoyouju.android.ui.theme.ErrorLight
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3
import kotlinx.coroutines.launch

/**
 * A02 当前关键变化确认（设计稿 docs/design/app/A02.png，宽度 375，第 1/4 步）
 *
 * 结构：自定义导航栏（返回 + 标题 + 步骤）→ 引导语 → 四道低负担题目
 *       （症状变化 / 需要医生及时评估的情况多选 / 涉及侧别 / 大约开始时间）→
 *       「下一步」+「先看已审核科普，稍后再填」。
 *
 * 产品红线：
 * - 缺失不默认阴性：没有回答的问题记录为「尚未确认」；
 * - 红旗项优先：勾选红旗选项立即跳转就医提示页（A03），不被登录阻断；
 * - 提交时 POST /analyses 命中红旗（40910/40911）同样走 A03 分支。
 */
@Composable
fun ChangeScreen(navController: NavHostController) {
    val episodesApi: EpisodesApi = NetworkModule.api()
    val scope = rememberCoroutineScope()

    // 第 1 题：症状变化（单选）
    val changeOptions = listOf("加重", "差不多", "减轻", "尚未确认")
    var change by remember { mutableStateOf<String?>(null) }
    // 第 2 题：需要医生及时评估的情况（多选）
    var redFlags by remember { mutableStateOf(setOf<String>()) }
    // 第 3 题：涉及侧别（单选）
    val sideOptions = listOf("左侧", "右侧", "双侧", "尚未确认")
    var side by remember { mutableStateOf<String?>(null) }
    // 第 4 题：大约开始时间（单选）
    val onsetOptions = listOf("记不清", "约1周内", "约1个月内", "超过3个月")
    var onset by remember { mutableStateOf<String?>(null) }

    var submitting by remember { mutableStateOf(false) }
    var toastText by remember { mutableStateOf("") }

    // 红旗选项（与 server 安全规则 RF-xx 对应）
    data class RedFlagOption(
        val key: String,
        val label: String,
        val signal: String,
        val match: String,
        val severity: String,
    )

    val redFlagOptions = listOf(
        RedFlagOption("bowel", "大小便控制异常", "大小便控制变化", "大小便控制变化", "high"),
        RedFlagOption("saddle", "会阴区或鞍区麻木", "会阴部麻木", "会阴部麻木", "high"),
        RedFlagOption("legs", "双腿进行性无力", "双腿进行性无力", "双腿进行性无力", "high"),
        RedFlagOption("fever", "发热、夜间痛持续不缓解或体重明显下降", "伴发热", "腰痛伴发热", "medium"),
    )
    val redFlagNone = "none"
    val redFlagUnsure = "unsure"

    fun hasHighSeverity(): Boolean =
        redFlagOptions.any { redFlags.contains(it.key) && it.severity == "high" }

    fun selectedSignals(): List<String> =
        redFlagOptions.filter { redFlags.contains(it.key) }.map { it.signal }

    fun selectedMatchTexts(): List<String> =
        redFlagOptions.filter { redFlags.contains(it.key) }.map { it.match }

    fun submit() {
        submitting = true
        scope.launch {
            try {
                // 命中 high 级红旗：立即跳就医提示（停止个性化分析）
                if (hasHighSeverity()) {
                    navController.navigate(
                        Routes.EMERGENCY + "?signals=" +
                            selectedSignals().joinToString(",") + "&stop=1",
                    )
                    return@launch
                }
                // 创建或更新病程，写入结构化摘要
                val episodes = handleResponse(episodesApi.list())
                val episodeId = episodes.firstOrNull()?.id
                if (episodeId == null) {
                    // 没有病程时先创建（起病时间取第 4 题）
                    val created = handleResponse(
                        episodesApi.create(
                            mapOf(
                                "title" to "我的腰痛病程",
                                "start_date" to (onset ?: "尚未确认"),
                            ),
                        ),
                    )
                    writeEvents(episodesApi, created.id, change, side, onset, selectedMatchTexts())
                } else {
                    writeEvents(episodesApi, episodeId, change, side, onset, selectedMatchTexts())
                }
                // 提交一页分析（命中红旗走就医提示分支）
                try {
                    handleResponse(
                        com.yaoyouju.android.core.net.AnalysesApi::class.let {
                            NetworkModule.api<com.yaoyouju.android.core.net.AnalysesApi>()
                        }.create(
                            mapOf("episode_id" to (episodeId ?: "")),
                        ),
                    )
                    toastText = "已记录，正在生成一页分析"
                } catch (e: Exception) {
                    val error = e as? com.yaoyouju.android.core.net.ApiException
                    if (error != null && (error.code == 40910 || error.code == 40911)) {
                        navController.navigate(Routes.EMERGENCY + "?stop=1")
                        return@launch
                    }
                    throw e
                }
                navController.navigate(Routes.HOME) {
                    popUpTo(Routes.HOME) { inclusive = true }
                }
            } catch (e: Exception) {
                toastText = e.message ?: "提交失败，请稍后重试"
            } finally {
                submitting = false
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Surface),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
        // 自定义导航栏
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface)
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
                text = "当前关键变化",
                fontSize = 17.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            Text(text = "第 1/4 步", fontSize = 12.sp, color = Text3)
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "接下来四个低负担问题，帮助我们理解你的情况。没有回答的问题会记录为「尚未确认」，不会默认阴性或无。",
                fontSize = 13.sp,
                color = Text2,
                lineHeight = 20.sp,
            )

            // 第 1 题
            Spacer(modifier = Modifier.height(24.dp))
            QuestionTitle(index = 1, text = "和上次相比，腰痛的变化是？")
            ChipRow(options = changeOptions, selected = change, onSelect = { change = it })
            }

            // 第 2 题（多选，命中红旗立即就医提示）
            Spacer(modifier = Modifier.height(24.dp))
            QuestionTitle(index = 2, text = "需要医生及时评估的情况（可多选）")
            AppNotice(
                type = NoticeType.Error,
                text = "勾选以下任一选项会立即展示就医提示，不被登录或后续题目阻断。",
            )
            Spacer(modifier = Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                redFlagOptions.forEach { option ->
                    MultiSelectRow(
                        text = option.label,
                        checked = redFlags.contains(option.key),
                        danger = option.severity == "high",
                        onToggle = {
                            val next = redFlags.toMutableSet()
                            if (next.contains(option.key)) {
                                next.remove(option.key)
                            } else {
                                next.add(option.key)
                                next.remove(redFlagNone)
                                next.remove(redFlagUnsure)
                            }
                            redFlags = next
                            // 红旗优先：勾选即跳转
                            if (option.severity == "high") {
                                navController.navigate(
                                    Routes.EMERGENCY + "?signals=" + option.signal + "&stop=1",
                                )
                            }
                        },
                    )
                }
                MultiSelectRow(
                    text = "以上都没有",
                    checked = redFlags.contains(redFlagNone),
                    danger = false,
                    onToggle = {
                        val next = mutableSetOf<String>()
                        if (!redFlags.contains(redFlagNone)) next.add(redFlagNone)
                        redFlags = next
                    },
                )
                MultiSelectRow(
                    text = "不确定",
                    checked = redFlags.contains(redFlagUnsure),
                    danger = false,
                    onToggle = {
                        val next = mutableSetOf<String>()
                        if (!redFlags.contains(redFlagUnsure)) next.add(redFlagUnsure)
                        redFlags = next
                    },
                )
            }

            // 第 3 题
            Spacer(modifier = Modifier.height(24.dp))
            QuestionTitle(index = 3, text = "疼痛涉及哪个侧别？")
            ChipRow(options = sideOptions, selected = side, onSelect = { side = it })

            // 第 4 题
            Spacer(modifier = Modifier.height(24.dp))
            QuestionTitle(index = 4, text = "大约什么时候开始的？")
            ChipRow(options = onsetOptions, selected = onset, onSelect = { onset = it })

            Spacer(modifier = Modifier.height(32.dp))

            // 主按钮
            AppButton(
                text = "下一步",
                type = AppButtonType.Primary,
                block = true,
                loading = submitting,
                onClick = { submit() },
            )

            Spacer(modifier = Modifier.height(12.dp))

            // 次要按钮
            AppButton(
                text = "先看已审核科普，稍后再填",
                type = AppButtonType.Secondary,
                block = true,
                onClick = { navController.navigate(Routes.CONTENTS) },
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

/** 单选芯片行（自绘，保证长文案可换行） */
@Composable
private fun ChipRow(
    options: List<String>,
    selected: String?,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { option ->
                    AppChip(
                        text = option,
                        selected = selected == option,
                        onClick = { onSelect(option) },
                        modifier = Modifier.weight(1f),
                    )
                }
                if (row.size == 1) Spacer(modifier = Modifier.weight(1f))
            }
        }
    }
}

/** 题目标题 */
@Composable
private fun QuestionTitle(index: Int, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(22.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(Primary),
            contentAlignment = Alignment.Center,
        ) {
            Text(text = "$index", fontSize = 12.sp, color = Surface)
        }
        Spacer(modifier = Modifier.width(8.dp))
        Text(text = text, fontSize = 15.sp, color = Text1)
    }
}

/** 多选行（红旗项用危险色） */
@Composable
private fun MultiSelectRow(
    text: String,
    checked: Boolean,
    danger: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (danger && checked) ErrorLight else Surface)
            .clickable { onToggle() }
            .padding(vertical = 12.dp, horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(20.dp)
                .clip(RoundedCornerShape(5.dp))
                .background(
                    when {
                        danger && checked -> Error
                        checked -> Primary
                        else -> Surface
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) {
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = null,
                    tint = Surface,
                    modifier = Modifier.size(13.dp),
                )
            }
        }
        Spacer(modifier = Modifier.width(10.dp))
        Text(
            text = text,
            fontSize = 13.sp,
            color = if (danger) Error else Text1,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 写入结构化摘要事件（缺失不默认阴性） */
private suspend fun writeEvents(
    episodesApi: EpisodesApi,
    episodeId: String,
    change: String?,
    side: String?,
    onset: String?,
    matchTexts: List<String>,
) {
    val events = mutableListOf<Map<String, Any>>()
    events.add(
        mapOf(
            "event_type" to "症状",
            "label" to "症状变化",
            "detail" to (change ?: "尚未确认"),
            "verify_status" to "尚未确认",
            "source_type" to "自述",
        ),
    )
    events.add(
        mapOf(
            "event_type" to "症状",
            "label" to "涉及侧别",
            "detail" to (side ?: "尚未确认"),
            "verify_status" to "尚未确认",
            "source_type" to "自述",
        ),
    )
    events.add(
        mapOf(
            "event_type" to "症状",
            "label" to "大约开始时间",
            "detail" to (onset ?: "尚未确认"),
            "verify_status" to "尚未确认",
            "source_type" to "自述",
        ),
    )
    if (matchTexts.isNotEmpty()) {
        events.add(
            mapOf(
                "event_type" to "症状",
                "label" to "需要医生及时评估的情况",
                "detail" to matchTexts.joinToString("、"),
                "verify_status" to "尚未确认",
                "source_type" to "自述",
            ),
        )
    }
    events.forEach { event ->
        handleResponse(
            episodesApi.update(
                episodeId,
                mapOf("events" to events),
            ),
        )
    }
}
