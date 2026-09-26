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
import com.yaoyouju.android.core.net.EpisodesApi
import com.yaoyouju.android.core.net.FollowupApi2
import com.yaoyouju.android.core.net.FollowupSection
import com.yaoyouju.android.core.net.FollowupSummaryView
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
import com.yaoyouju.android.ui.theme.Info
import com.yaoyouju.android.ui.theme.InfoLight
import com.yaoyouju.android.ui.theme.NeutralLight
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3
import kotlinx.coroutines.launch

/**
 * A12 复诊摘要预览与导出（设计稿 docs/design/app/A12.png，宽度 375，主 Tab）
 *
 * 固定六段；区分自述 / 报告原文 / 医生记录；未核实项保留；
 * 用户预览后自主导出；导出后由用户自行决定是否分享给医生。
 *
 * 数据全部来自 server 接口：
 * - POST /episodes/{id}/followup/generate      生成六段草稿
 * - GET  /episodes/{id}/followup               最新一份摘要
 * - PUT  /episodes/{id}/followup/{summaryId}   预览后纠正
 * - POST /episodes/{id}/followup/{summaryId}/export  导出（文本 / PDF / 图片）
 */
@Composable
fun FollowupScreen(navController: NavHostController) {
    val followupApi: FollowupApi2 = NetworkModule.api()
    val episodesApi: EpisodesApi = NetworkModule.api()
    val scope = rememberCoroutineScope()

    var loading by remember { mutableStateOf(true) }
    var generating by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    var summary by remember { mutableStateOf<FollowupSummaryView?>(null) }
    var toastText by remember { mutableStateOf("") }
    var exportText by remember { mutableStateOf("") }

    // 三个页签（按设计稿）
    val tabs = listOf("六段草稿", "导出预览", "问题清单")
    var tab by remember { mutableStateOf(tabs[0]) }

    fun load() {
        loading = true
        scope.launch {
            try {
                val episodes = handleResponse(episodesApi.list())
                val episode = episodes.firstOrNull()
                if (episode != null) {
                    summary = try {
                        handleResponse(followupApi.latest(episode.id))
                    } catch (_: Exception) {
                        null
                    }
                }
            } catch (e: Exception) {
                toastText = e.message ?: "摘要加载失败"
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    fun generate() {
        generating = true
        scope.launch {
            try {
                val episodes = handleResponse(episodesApi.list())
                val episode = episodes.firstOrNull()
                if (episode == null) {
                    toastText = "还没有病程，请先记录当前关键变化"
                    return@launch
                }
                summary = handleResponse(followupApi.generate(episode.id))
                toastText = "已生成六段草稿"
            } catch (e: Exception) {
                toastText = e.message ?: "生成失败，请稍后重试"
            } finally {
                generating = false
            }
        }
    }

    fun export(format: String) {
        exporting = true
        scope.launch {
            try {
                val s = summary
                val episodes = handleResponse(episodesApi.list())
                val episode = episodes.firstOrNull()
                if (s == null || episode == null) {
                    toastText = "请先生成复诊摘要"
                    return@launch
                }
                val result = handleResponse(
                    followupApi.export(episode.id, s.id, mapOf("format" to format)),
                )
                exportText = result.content
                tab = tabs[1]
                toastText = "已导出（$format），请自行决定是否分享给医生"
                load()
            } catch (e: Exception) {
                toastText = e.message ?: "导出失败，请稍后重试"
            } finally {
                exporting = false
            }
        }
    }

    val questionsSection: FollowupSection? =
        summary?.content?.sections?.firstOrNull { it.key == "questions" }

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
                text = "复诊摘要",
                fontSize = 17.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            if (summary?.corrected == true) {
                StatusTag(status = StatusKey.Confirmed)
            }
        }

        // 页签
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
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

        Box(modifier = Modifier.weight(1f)) {
            when {
                loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(text = "加载中…", fontSize = 13.sp, color = Text3)
                }

                tab == tabs[0] -> Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp),
                ) {
                    Spacer(modifier = Modifier.height(16.dp))
                    AppNotice(
                        type = NoticeType.Info,
                        text = "固定六段：仅整理你记录与录入的内容，未核实项会保留，不会默认阴性。",
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    val s = summary
                    if (s == null) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(NeutralLight)
                                .padding(20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(text = "还没有复诊摘要", fontSize = 15.sp, color = Text1)
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = "生成后可预览六段草稿，确认后自行导出。",
                                fontSize = 12.sp,
                                color = Text2,
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            AppButton(
                                text = "生成六段草稿",
                                type = AppButtonType.Primary,
                                loading = generating,
                                onClick = { generate() },
                            )
                        }
                    } else {
                        s.content.sections.forEachIndexed { index, section ->
                            SectionCard(index = index + 1, section = section)
                            Spacer(modifier = Modifier.height(10.dp))
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = s.disclaimer,
                            fontSize = 11.sp,
                            color = Text3,
                            lineHeight = 18.sp,
                        )
                    }
                    Spacer(modifier = Modifier.height(24.dp))
                }

                tab == tabs[1] -> Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp),
                ) {
                    Spacer(modifier = Modifier.height(16.dp))
                    if (exportText.isBlank()) {
                        AppNotice(
                            type = NoticeType.Info,
                            text = "还没有导出内容。请在「六段草稿」页签确认后导出。",
                        )
                    } else {
                        AppCard {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Text(
                                    text = "导出内容（文本带头部与水印脚注）",
                                    fontSize = 12.sp,
                                    color = Text3,
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = exportText,
                                    fontSize = 12.sp,
                                    color = Text1,
                                    lineHeight = 20.sp,
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                        AppNotice(
                            type = NoticeType.Warn,
                            text = "导出后由你自行决定是否分享给医生；分享前请核对未核实项。",
                        )
                    }
                    Spacer(modifier = Modifier.height(24.dp))
                }

                else -> Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp),
                ) {
                    Spacer(modifier = Modifier.height(16.dp))
                    val q = questionsSection
                    if (q == null || q.items.isEmpty()) {
                        AppNotice(
                            type = NoticeType.Info,
                            text = "还没有问题清单。生成摘要后，勾选的复诊问题会汇总到这里。",
                        )
                    } else {
                        Text(text = q.title, fontSize = 15.sp, color = Text1)
                        Spacer(modifier = Modifier.height(8.dp))
                        q.items.forEach { item ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(PrimaryLight)
                                    .padding(12.dp),
                            ) {
                                Text(text = "· ", fontSize = 13.sp, color = Primary)
                                Text(text = item.text, fontSize = 13.sp, color = Text1)
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "该段条目是「问题」，不标核实状态；导出前可自行删改。",
                            fontSize = 11.sp,
                            color = Text3,
                        )
                    }
                    Spacer(modifier = Modifier.height(24.dp))
                }
            }
        }

        // 底部操作区
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            AppButton(
                text = "导出文本",
                type = AppButtonType.Primary,
                modifier = Modifier.weight(1f),
                loading = exporting,
                onClick = { export("文本") },
            )
            AppButton(
                text = "导出 PDF",
                type = AppButtonType.Secondary,
                modifier = Modifier.weight(1f),
                onClick = { export("PDF") },
            )
            AppButton(
                text = "导出图片",
                type = AppButtonType.Secondary,
                modifier = Modifier.weight(1f),
                onClick = { export("图片") },
            )
        }

        Spacer(modifier = Modifier.height(16.dp))
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
                    .padding(bottom = 140.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Text1.copy(alpha = 0.85f))
                    .padding(horizontal = 20.dp, vertical = 10.dp),
            )
        }
    }
}

/** 六段中的一段 */
@Composable
private fun SectionCard(index: Int, section: FollowupSection) {
    AppCard {
        Column(modifier = Modifier.padding(14.dp)) {
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
                Text(text = section.title, fontSize = 14.sp, color = Text1)
            }
            Spacer(modifier = Modifier.height(10.dp))
            section.items.forEach { item ->
                Row(modifier = Modifier.padding(vertical = 4.dp)) {
                    Text(text = "· ", fontSize = 13.sp, color = Text3)
                    Column(modifier = Modifier.weight(1f)) {
                        Text(text = item.text, fontSize = 13.sp, color = Text1)
                        // 来源与核实状态（问题段不标核实状态）
                        val meta = buildList {
                            if (!item.sourceType.isNullOrBlank()) add("来源：" + item.sourceType)
                            if (section.key != "questions" && !item.verifyStatus.isNullOrBlank()) {
                                add(item.verifyStatus)
                            }
                        }
                        if (meta.isNotEmpty()) {
                            Text(
                                text = meta.joinToString(" · "),
                                fontSize = 11.sp,
                                color = Text3,
                            )
                        }
                    }
                }
            }
        }
    }
}
