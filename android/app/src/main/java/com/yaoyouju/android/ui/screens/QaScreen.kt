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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.yaoyouju.android.core.net.EpisodesApi
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.QaApi
import com.yaoyouju.android.core.net.QaMessageView
import com.yaoyouju.android.core.net.ReportsApi
import com.yaoyouju.android.core.net.handleResponse
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
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
 * A09 问与解释（设计稿 docs/design/app/A09.png，宽度 375，主 Tab）
 *
 * 基于当前上下文回答追问并引用来源；越界问题（诊断 / 手术 / 用药）明确不答，
 * 并可一键加入复诊问题；反复求保证时给出稳定解释并结束本轮。
 *
 * 数据全部来自 server 接口：
 * - POST /qa/sessions              创建会话（关联当前病程）
 * - GET  /qa/sessions              历史会话
 * - GET  /qa/sessions/{id}         会话详情
 * - POST /qa/sessions/{id}/messages 提问
 * - POST /qa/sessions/{id}/close   结束本轮（小结）
 */
@Composable
fun QaScreen(navController: NavHostController) {
    val qaApi: QaApi = NetworkModule.api()
    val episodesApi: EpisodesApi = NetworkModule.api()
    val reportsApi: ReportsApi = NetworkModule.api()
    val scope = rememberCoroutineScope()

    var sessionId by remember { mutableStateOf("") }
    var messages by remember { mutableStateOf<List<QaMessageView>>(emptyList()) }
    var inputText by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var contextLabel by remember { mutableStateOf("") }
    var toastText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    /** 建议问题（按设计稿的示例问题，用户点击即提问） */
    val suggestions = listOf("复诊时该怎么描述？", "哪些变化要提前就医？", "保守治疗一般多久？")

    fun loadContext() {
        scope.launch {
            try {
                val episodes = handleResponse(episodesApi.list())
                val episode = episodes.firstOrNull()
                if (episode != null) {
                    val structured = handleResponse(reportsApi.structured(episode.id))
                    val reportDates = structured.items.mapNotNull { it.report?.reportDate }.distinct()
                    contextLabel = if (reportDates.isEmpty()) {
                        "基于：当前情况（${episode.startDate ?: "尚未确认"}）"
                    } else {
                        "基于：当前情况（${episode.startDate ?: "尚未确认"}）+ 报告日期（${reportDates.joinToString("、")}）"
                    }
                }
            } catch (_: Exception) {
                contextLabel = "基于：当前情况"
            }
        }
    }

    fun initOnce() {
        if (sessionId.isNotBlank()) return
        scope.launch {
            try {
                // 幂等：已有会话不重复创建
                val sessions = handleResponse(qaApi.listSessions())
                val existing = sessions.firstOrNull()
                if (existing != null) {
                    sessionId = existing.id
                    val detail = handleResponse(qaApi.session(existing.id))
                    messages = detail.messages
                } else {
                    val episodes = handleResponse(episodesApi.list())
                    val episode = episodes.firstOrNull()
                    val session = handleResponse(
                        qaApi.createSession(
                            if (episode != null) mapOf("episode_id" to episode.id) else emptyMap(),
                        ),
                    )
                    sessionId = session.id
                    messages = session.messages
                }
                loadContext()
            } catch (e: Exception) {
                toastText = e.message ?: "初始化失败，请稍后重试"
            }
        }
    }

    LaunchedEffect(Unit) { initOnce() }

    fun ask(question: String) {
        if (question.isBlank() || sessionId.isBlank()) return
        sending = true
        scope.launch {
            try {
                // 本地先显示用户消息（乐观更新）
                val localUser = QaMessageView(
                    id = "local-" + System.currentTimeMillis(),
                    role = "user",
                    content = question,
                    citations = emptyList(),
                    refused = false,
                    followupQuestion = null,
                    addToFollowup = false,
                    createdAt = "",
                )
                messages = messages + localUser
                inputText = ""
                val result = handleResponse(qaApi.ask(sessionId, mapOf("content" to question)))
                // 拉取最新会话详情（含 assistant 回复与引用）
                val detail = handleResponse(qaApi.session(result.sessionId))
                messages = detail.messages
            } catch (e: Exception) {
                toastText = e.message ?: "提问失败，请稍后重试"
                // 回滚乐观更新
                messages = messages.filterNot { it.id.startsWith("local-") }
            } finally {
                sending = false
            }
        }
    }

    // 新消息滚到底部
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
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
                text = "问与解释",
                fontSize = 20.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = "已答 ${messages.count { it.role == "assistant" }} 条",
                fontSize = 11.sp,
                color = Text3,
            )
        }

        // 上下文说明
        if (contextLabel.isNotBlank()) {
            Text(
                text = contextLabel,
                fontSize = 11.sp,
                color = Text3,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }

        Box(modifier = Modifier.weight(1f)) {
            if (messages.isEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(text = "问与解释", fontSize = 18.sp, color = Text1)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "基于你的报告与病程记录回答，每条回答都带来源；诊断、手术、用药类问题会明确不答。",
                        fontSize = 12.sp,
                        color = Text2,
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        horizontal = 20.dp,
                        vertical = 12.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(messages) { message ->
                        MessageBubble(
                            message = message,
                            onAddFollowup = { text ->
                                toastText = "已加入复诊问题：$text"
                            },
                        )
                    }
                }
            }
        }

        // 建议问题
        if (messages.isEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                suggestions.forEach { suggestion ->
                    Text(
                        text = suggestion,
                        fontSize = 11.sp,
                        color = Primary,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(PrimaryLight)
                            .clickable { ask(suggestion) }
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        // 输入区
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface)
                .imePadding()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = inputText,
                onValueChange = { inputText = it },
                placeholder = { Text("说说你的疑问…", color = Text3, fontSize = 13.sp) },
                maxLines = 3,
                shape = RoundedCornerShape(22.dp),
                modifier = Modifier.weight(1f),
            )
            Spacer(modifier = Modifier.width(8.dp))
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(if (sending || inputText.isBlank()) NeutralLight else Primary)
                    .clickable(enabled = !sending && inputText.isNotBlank()) { ask(inputText) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.Send,
                    contentDescription = "发送",
                    tint = Surface,
                    modifier = Modifier.size(20.dp),
                )
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        AppNotice(
            type = NoticeType.Info,
            text = "回答仅供参考，不构成诊断；越界问题会明确不答。",
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        Spacer(modifier = Modifier.height(8.dp))
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
                    .padding(bottom = 160.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Text1.copy(alpha = 0.85f))
                    .padding(horizontal = 20.dp, vertical = 10.dp),
            )
        }
    }
}

/** 消息气泡 */
@Composable
private fun MessageBubble(
    message: QaMessageView,
    onAddFollowup: (String) -> Unit,
) {
    val isUser = message.role == "user"
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
        Box(
            modifier = Modifier
                .clip(
                    RoundedCornerShape(
                        topStart = 14.dp,
                        topEnd = 14.dp,
                        bottomStart = if (isUser) 14.dp else 4.dp,
                        bottomEnd = if (isUser) 4.dp else 14.dp,
                    ),
                )
                .background(if (isUser) Primary else NeutralLight)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text(
                text = message.content,
                fontSize = 13.sp,
                color = if (isUser) Surface else Text1,
            )
        }
        // 引用（assistant）
        if (!isUser && message.citations.isNotEmpty()) {
            Spacer(modifier = Modifier.height(6.dp))
            message.citations.forEach { cite ->
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(InfoLight)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(
                        text = "来源：" + (cite.sourceLabel ?: cite.statement ?: "见引用"),
                        fontSize = 11.sp,
                        color = Info,
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
            }
        }
        // 越界拒答：可一键加入复诊问题
        if (!isUser && message.refused && message.addToFollowup) {
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "加入复诊问题",
                fontSize = 11.sp,
                color = Primary,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(PrimaryLight)
                    .clickable { onAddFollowup(message.followupQuestion ?: message.content) }
                    .padding(horizontal = 10.dp, vertical = 5.dp),
            )
        }
        // 拒答标记
        if (!isUser && message.refused) {
            Spacer(modifier = Modifier.height(4.dp))
            StatusTag(status = StatusKey.NoDiagnosis)
        }
    }
}
