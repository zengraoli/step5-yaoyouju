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
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.input.KeyboardType
import androidx.navigation.NavHostController
import com.yaoyouju.android.core.net.CreateCareEventRequest
import com.yaoyouju.android.core.net.CreateEpisodeRequest
import com.yaoyouju.android.core.net.CreateReportRequest
import com.yaoyouju.android.core.net.EpisodesApi
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.ReportsApi
import com.yaoyouju.android.core.net.handleResponse
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
import com.yaoyouju.android.ui.components.AppNotice
import com.yaoyouju.android.ui.components.NoticeType
import com.yaoyouju.android.ui.components.StatusKey
import com.yaoyouju.android.ui.components.StatusTag
import com.yaoyouju.android.ui.navigation.Routes
import com.yaoyouju.android.ui.theme.Bg
import com.yaoyouju.android.ui.theme.NeutralLight
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3
import kotlinx.coroutines.launch

/**
 * A05 录入报告与医嘱（设计稿 docs/design/app/A05.png，宽度 375，第 3/4 步，可选）
 *
 * 主路径是粘贴文字；拍照提取为模拟 OCR（受「拍照提取」功能开关控制，默认关闭）；
 * 记录来源类型与报告日期；既有医嘱作为「自述」事件保存（来源可见）。
 *
 * 产品红线：
 * - 原文仅用于对照解释，本产品不做影像读片诊断；
 * - 不会把报告中未描述的内容写成「已排除」；
 * - 本步可跳过（跳过不写入任何报告，也不当作「没有报告」）。
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun ReportInputScreen(navController: NavHostController) {
    val reportsApi: ReportsApi = NetworkModule.api()
    val episodesApi: EpisodesApi = NetworkModule.api()
    val scope = rememberCoroutineScope()

    // 三个页签（按设计稿）
    val tabs = listOf("粘贴文字（推荐）", "拍照提取", "暂不录入")
    var tab by remember { mutableStateOf(tabs[0]) }

    var reportText by remember { mutableStateOf("") }
    var reportDate by remember { mutableStateOf("") }
    val examTypes = listOf("MRI", "CT", "X 光", "超声", "其他")
    var examType by remember { mutableStateOf(examTypes[0]) }
    /** 检查机构（可选；写入报告原文来源行） */
    var institution by remember { mutableStateOf("") }
    var doctorAdvice by remember { mutableStateOf("") }

    var submitting by remember { mutableStateOf(false) }
    var ocrLoading by remember { mutableStateOf(false) }
    var toastText by remember { mutableStateOf("") }
    var showEmergency by remember { mutableStateOf(false) }
    var reportSafetyLabels by remember { mutableStateOf("") }
    var reportSafetyStop by remember { mutableStateOf(false) }

    /** 医生建议快捷标签（点击追加到文本域） */
    val adviceChips = listOf("保守治疗", "复查时间", "用药", "手术评估", "康复建议")

        fun submit() {
        submitting = true
        scope.launch {
            try {
                val episodes: List<com.yaoyouju.android.core.net.EpisodeItem> = handleResponse(episodesApi.list())
                var episodeId = episodes.firstOrNull()?.id
                if (episodeId == null) {
                    episodeId = handleResponse(
                        episodesApi.create(CreateEpisodeRequest(title = "我的腰痛病程")),
                    ).id
                }
                val id = episodeId ?: return@launch
                if (tab == tabs[0] && reportText.isNotBlank()) {
                    // 检查类型与机构写进事件原文（服务端按原文保存并抽取术语）
                    val head = buildString {
                        append(reportDate)
                        append(" ")
                        append(examType)
                        if (institution.isNotBlank()) append(" · ").append(institution.trim())
                        append("\n")
                    }
                    val report = handleResponse(
                        reportsApi.create(
                            CreateReportRequest(
                                episodeId = id,
                                rawText = head + reportText,
                                reportDate = reportDate,
                            ),
                        ),
                    )
                    // 命中红旗：报告仍然录入，但立刻给出就医提示
                    val notice = report.safetyNotice
                    if (notice != null && notice.matched.isNotEmpty()) {
                        val labels = notice.matched.joinToString("、") { it.label }
                        val stop = notice.matched.any { it.severity == "high" }
                        reportSafetyLabels = labels
                        reportSafetyStop = stop
                        showEmergency = true
                        return@launch
                    }
                }
                if (doctorAdvice.isNotBlank()) {
                    handleResponse(
                        episodesApi.addEvent(
                            id,
                            CreateCareEventRequest(
                                eventType = "医嘱",
                                occurredAt = java.time.Instant.now().toString(),
                                sourceType = "自述",
                                rawText = "医生已经给出的建议（自述转述，尚未核实）：$doctorAdvice",
                                verifyStatus = "尚未确认",
                            ),
                        ),
                    )
                }
                navController.navigate(Routes.REPORT_VERIFY)
            } catch (e: Exception) {
                toastText = e.userMessage()
            } finally {
                submitting = false
            }
        }
    }

    if (showEmergency) {
        EmergencyScreen(navController = navController, signals = reportSafetyLabels, stop = reportSafetyStop)
        return
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
                text = "录入报告与医嘱",
                fontSize = 17.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            Text(text = "第 3/4 步 · 可选", fontSize = 12.sp, color = Text3)
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Spacer(modifier = Modifier.height(12.dp))

            // 页签
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(NeutralLight)
                    .padding(3.dp),
            ) {
                tabs.forEach { item ->
                    Text(
                        text = item,
                        fontSize = 12.sp,
                        color = if (tab == item) Text1 else Text3,
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (tab == item) Surface else NeutralLight)
                            .clickable { tab = item }
                            .padding(vertical = 8.dp),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            when (tab) {
                tabs[0] -> {
                    // 粘贴文字（推荐）
                    Text(text = "检查类型", fontSize = 13.sp, color = Text2)
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        examTypes.forEach { type ->
                            Text(
                                text = type,
                                fontSize = 12.sp,
                                color = if (examType == type) Surface else Text2,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (examType == type) Primary else NeutralLight)
                                    .clickable { examType = type }
                                    .padding(horizontal = 12.dp, vertical = 7.dp),
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))
                    Text(text = "检查机构（可选）", fontSize = 13.sp, color = Text2)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = institution,
                        onValueChange = { institution = it },
                        placeholder = { Text("例如：市第一医院", fontSize = 12.sp) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    Text(text = "报告日期", fontSize = 13.sp, color = Text2)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = reportDate,
                        onValueChange = { reportDate = it },
                        placeholder = { Text("如 2026-08-30（可留空）", color = Text3) },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    Text(text = "报告原文", fontSize = 13.sp, color = Text2)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = reportText,
                        onValueChange = { reportText = it },
                        placeholder = {
                            Text(
                                "粘贴报告或医嘱原文（原文仅用于对照解释，本产品不做影像读片诊断）",
                                color = Text3,
                            )
                        },
                        minLines = 6,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    AppNotice(
                        type = NoticeType.Info,
                        text = "原文仅用于对照解释；不会把报告中未描述的内容写成「已排除」。",
                    )
                }

                tabs[1] -> {
                    // 拍照提取（模拟 OCR）
                    Text(text = "拍照提取（模拟 OCR）", fontSize = 15.sp, color = Text1)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "主路径是粘贴文字。拍照提取为演示实现，返回示例文本，请核对后使用。",
                        fontSize = 12.sp,
                        color = Text2,
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(160.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Bg)
                            .clickable {
                                ocrLoading = true
                                scope.launch {
                                    try {
                                        val ocr = handleResponse(reportsApi.ocr())
                                        reportText = ocr.text
                                        tab = tabs[0]
                                        toastText = "已提取示例文本，请核对后使用"
                                    } catch (e: Exception) {
                                        toastText = e.userMessage()
                                    } finally {
                                        ocrLoading = false
                                    }
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = if (ocrLoading) "识别中…" else "点击拍摄 / 选择照片",
                            fontSize = 14.sp,
                            color = Text3,
                        )
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    AppNotice(
                        type = NoticeType.Warn,
                        text = "模拟 OCR 仅返回示例文本，不作为真实识别结果。",
                    )
                }

                else -> {
                    // 暂不录入
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(NeutralLight)
                            .padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(text = "暂不录入报告", fontSize = 15.sp, color = Text1)
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "跳过不写入任何报告，也不当作「没有报告」。",
                            fontSize = 12.sp,
                            color = Text2,
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // 既有医嘱（来源可见）
            Text(text = "既有医嘱（可选）", fontSize = 15.sp, color = Text1)
            Spacer(modifier = Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "保存为「自述」事件，来源可见",
                    fontSize = 11.sp,
                    color = Text3,
                    modifier = Modifier.weight(1f),
                )
                StatusTag(status = StatusKey.Self)
            }
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedTextField(
                value = doctorAdvice,
                onValueChange = { doctorAdvice = it },
                placeholder = { Text("如：医生建议卧床休息两周，避免弯腰搬重物", color = Text3) },
                minLines = 3,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(12.dp))

            // 快捷标签：用 FlowRow 自动换行，窄屏不会竖排四行（第七轮第 34 条）
            androidx.compose.foundation.layout.FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                adviceChips.forEach { chip ->
                    Text(
                        text = chip,
                        fontSize = 12.sp,
                        color = Text2,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(PrimaryLight)
                            .clickable {
                                doctorAdvice = if (doctorAdvice.isBlank()) chip else "$doctorAdvice；$chip"
                            }
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            AppButton(
                text = "下一步：核对结构化信息",
                type = AppButtonType.Primary,
                block = true,
                loading = submitting,
                onClick = { submit() },
            )

            Spacer(modifier = Modifier.height(12.dp))

            AppButton(
                text = "本步跳过",
                type = AppButtonType.Secondary,
                block = true,
                onClick = { navController.navigate(Routes.REPORT_VERIFY) },
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
