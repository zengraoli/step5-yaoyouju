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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
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
import androidx.navigation.NavHostController
import com.yaoyouju.android.core.net.AnalysesApi
import com.yaoyouju.android.core.net.FeedbackApi
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.handleResponse
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
import com.yaoyouju.android.ui.components.AppCard
import com.yaoyouju.android.ui.components.AppNotice
import com.yaoyouju.android.ui.components.NoticeType
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
import kotlinx.coroutines.launch

/**
 * A16 反馈与错误举报（设计稿 docs/design/app/A16.png，宽度 375）
 *
 * 自动附带分析 / 模型 / 内容 / 规则集四类版本；分类举报；
 * 单条授权查看；反馈不自动入库（由运营编辑和临床审核处理）。
 *
 * 数据全部来自 server 接口：
 * - GET  /analyses/{id}          被反馈的分析（版本与内容摘要）
 * - POST /feedback               帮助类型反馈
 * - POST /feedback/error-report  错误举报（自动附带四类版本）
 */
@Composable
fun FeedbackScreen(
    navController: NavHostController,
    analysisId: String = "",
) {
    val feedbackApi: FeedbackApi = NetworkModule.api()
    val analysesApi: AnalysesApi = NetworkModule.api()
    val scope = rememberCoroutineScope()

    // 两个页签（按设计稿）
    val tabs = listOf("帮助类型反馈", "错误举报")
    var tab by remember { mutableStateOf(tabs[0]) }

    // 帮助类型反馈
    val helpOptions = listOf("看懂了", "知道下一步", "都不好，问题没解决")
    var helpType by remember { mutableStateOf("") }
    var unsolved by remember { mutableStateOf("") }

    // 错误举报
    val reportTypes = listOf(
        "事实错误",
        "与我的报告不符",
        "越界（给了不该给的判断）",
        "缺少重要就医提示",
        "看不懂",
    )
    var reportTypesSelected by remember { mutableStateOf(setOf<String>()) }
    var reportDetail by remember { mutableStateOf("") }

    var submitting by remember { mutableStateOf(false) }
    var toastText by remember { mutableStateOf("") }

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
                text = "反馈与举报",
                fontSize = 17.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
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

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            // 版本说明（四类版本自动附带）
            AppNotice(
                type = NoticeType.Info,
                text = "提交时自动附带分析 / 模型 / 内容 / 规则集四类版本，方便定位；反馈不自动进入训练或内容库。",
            )

            Spacer(modifier = Modifier.height(20.dp))

            when (tab) {
                tabs[0] -> {
                    // 帮助类型反馈
                    Text(text = "这一页分析对你有帮助吗？", fontSize = 15.sp, color = Text1)
                    Spacer(modifier = Modifier.height(12.dp))
                    helpOptions.forEach { option ->
                        val checked = helpType == option
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (checked) PrimaryLight else Surface)
                                .then(
                                    if (checked) Modifier else Modifier.border(
                                        1.dp,
                                        Border,
                                        RoundedCornerShape(10.dp),
                                    ),
                                )
                                .clickable { helpType = option }
                                .padding(vertical = 12.dp, horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(18.dp)
                                    .clip(RoundedCornerShape(9.dp))
                                    .background(if (checked) Primary else Surface),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (checked) {
                                    Icon(
                                        imageVector = Icons.Filled.Check,
                                        contentDescription = null,
                                        tint = Surface,
                                        modifier = Modifier.size(11.dp),
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(text = option, fontSize = 13.sp, color = Text1)
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    Text(text = "还没解决的问题（可选）", fontSize = 13.sp, color = Text2)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = unsolved,
                        onValueChange = { unsolved = it },
                        placeholder = { Text("如：还是不确定什么时候要复诊", color = Text3) },
                        minLines = 2,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    AppButton(
                        text = "提交反馈",
                        type = AppButtonType.Primary,
                        block = true,
                        loading = submitting,
                        onClick = {
                            submitting = true
                            scope.launch {
                                try {
                                    val body = mutableMapOf<String, Any?>()
                                    if (analysisId.isNotBlank()) body["analysis_id"] = analysisId
                                    if (helpType.isNotBlank()) body["help_type"] = helpType
                                    if (unsolved.isNotBlank()) body["unsolved_question"] = unsolved
                                    handleResponse(feedbackApi.help(body))
                                    toastText = "已收到反馈，谢谢"
                                } catch (e: Exception) {
                                    toastText = e.message ?: "提交失败，请稍后重试"
                                } finally {
                                    submitting = false
                                }
                            }
                        },
                    )
                }

                else -> {
                    // 错误举报
                    Text(text = "问题类型（可多选）", fontSize = 15.sp, color = Text1)
                    Spacer(modifier = Modifier.height(12.dp))
                    reportTypes.forEach { type ->
                        val checked = reportTypesSelected.contains(type)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (checked) InfoLight else Surface)
                                .clickable {
                                    reportTypesSelected = if (checked) {
                                        reportTypesSelected - type
                                    } else {
                                        reportTypesSelected + type
                                    }
                                }
                                .padding(vertical = 10.dp, horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(18.dp)
                                    .clip(RoundedCornerShape(5.dp))
                                    .background(if (checked) Info else Surface),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (checked) {
                                    Icon(
                                        imageVector = Icons.Filled.Check,
                                        contentDescription = null,
                                        tint = Surface,
                                        modifier = Modifier.size(11.dp),
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(text = type, fontSize = 13.sp, color = Text1)
                        }
                        Spacer(modifier = Modifier.height(6.dp))
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    Text(text = "补充说明", fontSize = 13.sp, color = Text2)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = reportDetail,
                        onValueChange = { reportDetail = it },
                        placeholder = { Text("具体哪里不对、期望怎样（可选）", color = Text3) },
                        minLines = 3,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    AppNotice(
                        type = NoticeType.Warn,
                        text = "举报会进入后台队列，由运营编辑和临床审核处理；我们不会自动把你的内容用于训练。",
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    AppButton(
                        text = "提交举报",
                        type = AppButtonType.Danger,
                        block = true,
                        loading = submitting,
                        onClick = {
                            submitting = true
                            scope.launch {
                                try {
                                    val body = mutableMapOf<String, Any?>(
                                        "category" to reportTypesSelected.joinToString("、"),
                                        "description" to reportDetail,
                                        "severity" to "medium",
                                    )
                                    if (analysisId.isNotBlank()) body["analysis_id"] = analysisId
                                    handleResponse(feedbackApi.errorReport(body))
                                    toastText = "举报已提交，我们会尽快核实"
                                } catch (e: Exception) {
                                    toastText = e.message ?: "提交失败，请稍后重试"
                                } finally {
                                    submitting = false
                                }
                            }
                        },
                    )
                }
            }

            Spacer(modifier = Modifier.height(40.dp))
        }
    }

    if (toastText.isNotBlank()) {
        androidx.compose.runtime.LaunchedEffect(toastText) {
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
