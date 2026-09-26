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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.yaoyouju.android.core.net.AnalysesApi
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
import com.yaoyouju.android.ui.navigation.Routes
import com.yaoyouju.android.ui.theme.Info
import com.yaoyouju.android.ui.theme.InfoLight
import com.yaoyouju.android.ui.theme.NeutralLight
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3

/**
 * A08 原文对照（设计稿 docs/design/app/A08.png，宽度 375）
 *
 * 解释与原文逐句对应；高亮引用；「报告未提及」≠「已排除」。
 *
 * 数据全部来自 server 接口：
 * - GET /analyses/{id}            解释段（含引用）
 * - GET /episodes/{id}/structured 报告原文与术语位置
 */
@Composable
fun ReportDiffScreen(
    navController: NavHostController,
    analysisId: String = "",
    explainIndex: Int = 0,
) {
    val analysesApi: AnalysesApi = NetworkModule.api()
    val reportsApi: ReportsApi = NetworkModule.api()
    val episodesApi: EpisodesApi = NetworkModule.api()

    val tabs = listOf("按解释查看", "按术语查看")
    var tab by remember { mutableStateOf(tabs[0]) }

    var analysis by remember { mutableStateOf<com.yaoyouju.android.core.net.AnalysisView?>(null) }
    var items by remember { mutableStateOf<List<StructuredItem>>(emptyList()) }
    var selectedExplain by remember { mutableIntStateOf(explainIndex) }
    var errorText by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        loading = true
        try {
            val episodes = handleResponse(episodesApi.list())
            val episodeId = episodes.firstOrNull()?.id
            if (analysisId.isNotBlank()) {
                analysis = handleResponse(analysesApi.detail(analysisId))
            }
            if (episodeId != null) {
                val structured = handleResponse(reportsApi.structured(episodeId))
                items = structured.items
            }
        } catch (e: Exception) {
            errorText = e.message ?: "原文对照加载失败"
        } finally {
            loading = false
        }
    }

    // 报告原文（来自结构化条目里 raw_text 非空的项）
    val reportItems = items.filter { !it.rawText.isNullOrBlank() }
    val explainItems = analysis?.sections?.explain ?: emptyList()

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
                text = "原文对照",
                fontSize = 17.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            AppNotice(
                type = NoticeType.Info,
                text = "解释与原文逐句对应；「报告未提及」不等于「已排除」。",
            )

            Spacer(modifier = Modifier.height(16.dp))

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
            } else if (errorText.isNotBlank()) {
                AppNotice(type = NoticeType.Error, text = errorText)
            } else when (tab) {
                tabs[0] -> {
                    // 按解释查看：解释 → 引用 → 原文位置
                    if (explainItems.isEmpty()) {
                        Text(
                            text = "还没有可对照的解释，请先生成一页分析。",
                            fontSize = 12.sp,
                            color = Text3,
                        )
                    } else {
                        explainItems.forEachIndexed { index, item ->
                            val selected = index == selectedExplain
                            AppCard(
                                background = if (selected) InfoLight else Surface,
                                borderColor = if (selected) Info else com.yaoyouju.android.ui.theme.Border,
                                modifier = Modifier.padding(bottom = 10.dp),
                            ) {
                                Column(modifier = Modifier.padding(12.dp)) {
                                    Text(
                                        text = "解释 ${index + 1}",
                                        fontSize = 11.sp,
                                        color = if (selected) Info else Text3,
                                    )
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = item.text,
                                        fontSize = 13.sp,
                                        color = Text1,
                                    )
                                    Spacer(modifier = Modifier.height(8.dp))
                                    // 引用（高亮）
                                    item.citations.forEach { cite ->
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .clip(RoundedCornerShape(6.dp))
                                                .background(Surface)
                                                .padding(8.dp),
                                        ) {
                                            Text(
                                                text = "「" + cite.statement + "」— " + cite.docTitle,
                                                fontSize = 11.sp,
                                                color = Info,
                                            )
                                        }
                                        Spacer(modifier = Modifier.height(6.dp))
                                    }
                                    // 对应的原文位置
                                    val raw = reportItems.firstOrNull { !it.rawText.isNullOrBlank() }?.rawText
                                    if (!raw.isNullOrBlank()) {
                                        Text(
                                            text = "原文：" + highlightTerms(raw),
                                            fontSize = 12.sp,
                                            color = Text2,
                                        )
                                    } else {
                                        Text(
                                            text = "原文：报告未提及（不等于已排除）",
                                            fontSize = 12.sp,
                                            color = Text3,
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(8.dp))
                                    Text(
                                        text = if (selected) "当前选中" else "点击查看",
                                        fontSize = 11.sp,
                                        color = if (selected) Info else Text3,
                                        modifier = Modifier.clickable { selectedExplain = index },
                                    )
                                }
                            }
                        }
                    }
                }

                else -> {
                    // 按术语查看：术语 → 原文位置
                    val allTerms = reportItems.flatMap { it.report?.extractedTerms ?: emptyList() }
                    if (allTerms.isEmpty()) {
                        Text(
                            text = "还没有可对照的术语，请先录入报告。",
                            fontSize = 12.sp,
                            color = Text3,
                        )
                    } else {
                        allTerms.forEach { term ->
                            AppCard(modifier = Modifier.padding(bottom = 10.dp)) {
                                Column(modifier = Modifier.padding(12.dp)) {
                                    Text(text = term.term, fontSize = 14.sp, color = Text1)
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = term.meaning ?: "释义尚未确认",
                                        fontSize = 12.sp,
                                        color = Text2,
                                    )
                                    if (term.position != null) {
                                        Spacer(modifier = Modifier.height(4.dp))
                                        Text(
                                            text = "原文位置：第 ${term.position + 1} 字",
                                            fontSize = 11.sp,
                                            color = Text3,
                                        )
                                    }
                                }
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        // 原文全文（术语高亮）
                        AppCard {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(text = "报告原文", fontSize = 12.sp, color = Text3)
                                Spacer(modifier = Modifier.height(6.dp))
                                val raw = reportItems.firstOrNull { !it.rawText.isNullOrBlank() }?.rawText ?: ""
                                Text(
                                    text = highlightTerms(raw),
                                    fontSize = 12.sp,
                                    color = Text2,
                                    lineHeight = 20.sp,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            AppButton(
                text = "返回一页分析",
                type = AppButtonType.Secondary,
                block = true,
                onClick = { navController.popBackStack() },
            )

            Spacer(modifier = Modifier.height(40.dp))
        }
    }
}

/** 术语高亮原文（用带样式的 AnnotatedString） */
@Composable
private fun highlightTerms(text: String): androidx.compose.ui.text.AnnotatedString {
    val terms = listOf("椎间盘", "突出", "L4/5", "L5/S1", "MRI", "CT")
    return buildAnnotatedString {
        var rest = text
        while (rest.isNotEmpty()) {
            val hit = terms.mapNotNull { term ->
                val idx = rest.indexOf(term)
                if (idx >= 0) idx to term else null
            }.minByOrNull { it.first }
            if (hit == null) {
                append(rest)
                break
            } else {
                append(rest.substring(0, hit.first))
                withStyle(SpanStyle(color = Info, background = InfoLight)) {
                    append(hit.second)
                }
                rest = rest.substring(hit.first + hit.second.length)
            }
        }
    }
}
