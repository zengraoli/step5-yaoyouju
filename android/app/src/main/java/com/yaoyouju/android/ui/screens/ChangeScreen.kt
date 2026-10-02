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
import com.yaoyouju.android.core.net.CreateAnalysisRequest
import com.yaoyouju.android.core.net.CreateCareEventRequest
import com.yaoyouju.android.core.net.CreateEpisodeRequest
import com.yaoyouju.android.core.net.EpisodesApi
import com.yaoyouju.android.core.net.SafetySignalException
import com.yaoyouju.android.core.net.UpdateEpisodeRequest
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
    val changeOptions = RedFlagOptions.changeOptions
    var change by remember { mutableStateOf<String?>(null) }
    // 第 2 题：需要医生及时评估的情况（多选）
    var redFlags by remember { mutableStateOf(setOf<String>()) }
    // 第 3 题：涉及侧别（单选）
    val sideOptions = RedFlagOptions.sideOptions
    var side by remember { mutableStateOf<String?>(null) }
    // 第 4 题：大约开始时间（单选）
    val onsetOptions = RedFlagOptions.onsetOptions
    var onset by remember { mutableStateOf<String?>(null) }

    var submitting by remember { mutableStateOf(false) }
    var toastText by remember { mutableStateOf("") }

    // 红旗选项（与 server 安全规则 RF-xx 对应；逻辑见 RedFlagOptions，单元测试直接验证）
    val redFlagOptions = RedFlagOptions.all
    val redFlagNone = RedFlagOptions.NONE_KEY
    val redFlagUnsure = RedFlagOptions.UNSURE_KEY

    fun onsetDateOf(option: String?): String? = RedFlagOptions.onsetDateOf(option)

    fun hasHighSeverity(): Boolean = RedFlagOptions.hasHighSeverity(redFlags)

    fun selectedSignals(): List<String> = RedFlagOptions.signalsOf(redFlags)

    fun selectedMatchTexts(): List<String> = RedFlagOptions.matchTextsOf(redFlags)

    /** 取进行中的病程；没有则按第 4 题答案创建（缺失不默认阴性） */
    suspend fun ensureEpisode(): String? {
        val episodes = handleResponse(episodesApi.list())
        val existing = episodes.firstOrNull()?.id
        if (existing != null) {
            handleResponse(
                episodesApi.update(
                    existing,
                    UpdateEpisodeRequest(onsetDate = onsetDateOf(onset), onsetCertainty = "尚未确认"),
                ),
            )
            return existing
        }
        val created = handleResponse(
            episodesApi.create(
                CreateEpisodeRequest(title = "我的腰痛病程", onsetDate = onsetDateOf(onset)),
            ),
        )
        return created.id
    }


    fun submit() {
        submitting = true
        scope.launch {
            try {
                // 命中红旗：先把这次确认写进病程（服务端据此记录安全事件、之后拦下该病程的分析），
                // 再跳就医提示（产品红线：命中即提示，且不能被流程顺序绕过）
                val flags = RedFlagOptions.all.filter { redFlags.contains(it.key) }
                val high = flags.any { it.severity == "high" }
                val episodeId = ensureEpisode() ?: return@launch
                writeEvents(
                    episodesApi,
                    episodeId,
                    change,
                    side,
                    onset,
                    RedFlagOptions.matchTextsOf(redFlags),
                    RedFlagOptions.labelsOf(redFlags),
                )
                if (flags.isNotEmpty()) {
                    navController.navigate(
                        Routes.EMERGENCY + "?signals=" +
                            RedFlagOptions.signalsOf(redFlags).joinToString(",") + "&stop=" + if (high) "1" else "0",
                    )
                    return@launch
                }
                // 提交一页分析（命中红旗走就医提示分支）
                try {
                    handleResponse(
                        NetworkModule.api<com.yaoyouju.android.core.net.AnalysesApi>().create(
                            CreateAnalysisRequest(episodeId = episodeId),
                        ),
                    )
                    toastText = "已记录，正在生成一页分析"
                } catch (e: Exception) {
                    val error = e as? com.yaoyouju.android.core.net.ApiException
                    if (error != null && (error.code == 40910 || error.code == 40911)) {
                        navController.navigate(
                            Routes.EMERGENCY + "?signals=" +
                                RedFlagOptions.signalsOf(redFlags).joinToString(",") +
                                "&stop=" + if (error.code == 40911) "1" else "0",
                        )
                        return@launch
                    }
                    throw e
                }
                navController.navigate(Routes.HOME) {
                    popUpTo(Routes.HOME) { inclusive = true }
                }
            } catch (e: Exception) {
                val signal = e as? SafetySignalException
                if (signal != null) {
                    navController.navigate(
                        Routes.EMERGENCY + "?signals=" + signal.labels + "&stop=" + if (signal.stop) "1" else "0",
                    )
                } else {
                    toastText = e.userMessage()
                }
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

        // 顶部说明常驻（设计稿 A02）：不随问题滚动
        Text(
            text = "接下来四个低负担问题，帮助我们理解你的情况。没有回答的问题会记录为「尚未确认」，不会默认阴性或无。",
            fontSize = 13.sp,
            color = Text2,
            lineHeight = 20.sp,
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .padding(top = 12.dp),
        )

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            // 第 1 题
            Spacer(modifier = Modifier.height(24.dp))
            QuestionTitle(index = 1, text = "和上次相比，腰痛的变化是？")
            ChipRow(options = changeOptions, selected = change, onSelect = { change = it })

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
                            scope.launch {
                                val episodeId = runCatching { ensureEpisode() }.getOrNull()
                                if (episodeId != null) {
                                    runCatching {
                                        writeEvents(
                                            episodesApi,
                                            episodeId,
                                            change,
                                            side,
                                            onset,
                                            RedFlagOptions.matchTextsOf(redFlags),
                                            RedFlagOptions.labelsOf(redFlags),
                                        )
                                    }
                                }
                                navController.navigate(
                                    Routes.EMERGENCY + "?signals=" +
                                        RedFlagOptions.signalsOf(redFlags).joinToString(",") +
                                        "&stop=" + if (option.severity == "high") "1" else "0",
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
}

/** 单选芯片行（自绘，保证长文案可换行） */
@Composable
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
private fun ChipRow(
    options: List<String>,
    selected: String?,
    onSelect: (String) -> Unit,
) {
    // 芯片组用 FlowRow：长文案自动换行，不会被屏幕左右边裁掉（设计稿 A02）
    androidx.compose.foundation.layout.FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        options.forEach { option ->
            AppChip(
                text = option,
                selected = selected == option,
                skip = option == "尚未确认",
                onClick = { onSelect(option) },
            )
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
    flagLabels: List<String> = emptyList(),
) {
    val now = java.time.Instant.now().toString()
    // 紧凑单行记录：不在病程 / 一页分析里堆放问卷原文；未回答的记为「尚未确认」
    val parts = mutableListOf("关键变化确认（自述，尚未确认）：")
    parts.add("与上次相比：${change ?: "尚未确认"}")
    val flagText = if (flagLabels.isEmpty()) "尚未确认" else flagLabels.joinToString("、")
    parts.add("需医生及时评估的情况：${flagText}")
    parts.add("侧别：${side ?: "尚未确认"}")
    parts.add("起病：${onset ?: "尚未确认"}")
    if (matchTexts.isNotEmpty()) {
        parts.add("信号：${matchTexts.joinToString("、")}")
    }
    val event = handleResponse(
        episodesApi.addEvent(
            episodeId,
            CreateCareEventRequest(
                eventType = "症状",
                occurredAt = now,
                sourceType = "自述",
                rawText = parts.joinToString("；"),
                verifyStatus = "尚未确认",
            ),
        ),
    )
    // 命中红旗：立即跳就医提示（high 级停个性化分析）
    val notice = event.safetyNotice
    if (notice != null && notice.matched.isNotEmpty()) {
        val labels = notice.matched.joinToString("、") { it.label }
        val stop = notice.matched.any { it.severity == "high" }
        throw com.yaoyouju.android.core.net.SafetySignalException(labels, stop)
    }
}
