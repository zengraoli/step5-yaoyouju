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
import com.yaoyouju.android.core.net.ContentDetail
import com.yaoyouju.android.core.net.ContentsApi2
import com.yaoyouju.android.core.net.FeedbackApi
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.handleResponse
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
import com.yaoyouju.android.ui.components.AppCard
import com.yaoyouju.android.ui.components.AppNotice
import com.yaoyouju.android.ui.components.NoticeType
import com.yaoyouju.android.ui.components.StatusKey
import com.yaoyouju.android.ui.components.StatusTag
import com.yaoyouju.android.ui.theme.Border
import com.yaoyouju.android.ui.theme.Error
import com.yaoyouju.android.ui.theme.ErrorLight
import com.yaoyouju.android.ui.theme.Info
import com.yaoyouju.android.ui.theme.InfoLight
import com.yaoyouju.android.ui.theme.NeutralLight
import com.yaoyouju.android.ui.theme.Ok
import com.yaoyouju.android.ui.theme.OkLight
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3
import kotlinx.coroutines.launch

/**
 * A15 视频详情（设计稿 docs/design/app/A15.png，宽度 375）
 *
 * 适用 / 不适用范围、审核版本与依据、字幕与文字替代、复述任务检验理解。
 * 示意图不是用户真实病变；内容有误可举报。
 *
 * 数据全部来自 server 接口：
 * - GET /contents/{id}  内容详情（版本链、审核记录、字幕与文字替代）
 * - POST /feedback/error-report  内容举报（自动附带内容版本）
 */
@Composable
fun ContentDetailScreen(
    navController: NavHostController,
    contentId: String = "",
) {
    val contentsApi: ContentsApi2 = NetworkModule.api()
    val feedbackApi: FeedbackApi = NetworkModule.api()
    val scope = rememberCoroutineScope()

    var detail by remember { mutableStateOf<ContentDetail?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf("") }
    var subtitleOn by remember { mutableStateOf(true) }
    var toastText by remember { mutableStateOf("") }
    // 复述任务检验理解
    var recapText by remember { mutableStateOf("") }
    var recapDone by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        loading = true
        try {
            detail = handleResponse(contentsApi.detail(contentId))
        } catch (e: Exception) {
            errorText = e.message ?: "内容加载失败"
        } finally {
            loading = false
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
                text = detail?.title ?: "内容详情",
                fontSize = 17.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
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

                errorText.isNotBlank() -> Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    AppNotice(type = NoticeType.Error, text = errorText)
                    Spacer(modifier = Modifier.height(12.dp))
                    AppButton(
                        text = "返回内容库",
                        type = AppButtonType.Secondary,
                        onClick = { navController.popBackStack() },
                    )
                }

                else -> {
                    val d = detail ?: return@Box
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 20.dp),
                    ) {
                        Spacer(modifier = Modifier.height(8.dp))

                        // 播放器占位（示意图不是用户真实病变）
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(200.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(NeutralLight),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(text = "示意图（非你的影像）", fontSize = 14.sp, color = Text2)
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "本页演示不加载真实视频资源",
                                    fontSize = 11.sp,
                                    color = Text3,
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        // 字幕开关
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(InfoLight)
                                .clickable { subtitleOn = !subtitleOn }
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = if (subtitleOn) "字幕：开（CC）" else "字幕：关",
                                fontSize = 12.sp,
                                color = Info,
                                modifier = Modifier.weight(1f),
                            )
                            Text(text = "点击切换", fontSize = 11.sp, color = Info)
                        }

                        // 字幕文字替代
                        if (subtitleOn) {
                            Spacer(modifier = Modifier.height(8.dp))
                            AppCard {
                                Column(modifier = Modifier.padding(12.dp)) {
                                    Text(
                                        text = "文字替代（与字幕一致）",
                                        fontSize = 12.sp,
                                        color = Text3,
                                    )
                                    Spacer(modifier = Modifier.height(6.dp))
                                    Text(
                                        text = d.currentVersion?.subtitleText ?: "该版本暂无字幕文本",
                                        fontSize = 12.sp,
                                        color = Text2,
                                        lineHeight = 20.sp,
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        // 适用 / 不适用
                        AppCard {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Text(text = "适用范围", fontSize = 14.sp, color = Text1)
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = d.applicableScope,
                                    fontSize = 12.sp,
                                    color = Ok,
                                    lineHeight = 20.sp,
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                Text(text = "不适用范围", fontSize = 14.sp, color = Text1)
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = d.notApplicable,
                                    fontSize = 12.sp,
                                    color = Error,
                                    lineHeight = 20.sp,
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        // 版本与状态
                        AppCard {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = "当前版本 v" + (d.currentVersion?.version ?: 0),
                                        fontSize = 14.sp,
                                        color = Text1,
                                        modifier = Modifier.weight(1f),
                                    )
                                    StatusTag(
                                        status = if (d.offline) StatusKey.Offline else StatusKey.Reviewed,
                                    )
                                }
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "发布时间：" + (d.currentVersion?.publishedAt?.take(10) ?: "尚未确认"),
                                    fontSize = 11.sp,
                                    color = Text3,
                                )
                                // 版本链
                                if (d.versions.size > 1) {
                                    Spacer(modifier = Modifier.height(8.dp))
                                    Text(
                                        text = "版本链：" + d.versions.joinToString(" → ") { "v" + it.version },
                                        fontSize = 11.sp,
                                        color = Text3,
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        // 审核记录
                        AppCard {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Text(text = "审核记录", fontSize = 14.sp, color = Text1)
                                Spacer(modifier = Modifier.height(8.dp))
                                if (d.reviewRecords.isEmpty()) {
                                    Text(
                                        text = "暂无审核记录",
                                        fontSize = 12.sp,
                                        color = Text3,
                                    )
                                } else {
                                    d.reviewRecords.forEach { record ->
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(vertical = 4.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Box(
                                                modifier = Modifier
                                                    .size(16.dp)
                                                    .clip(RoundedCornerShape(8.dp))
                                                    .background(
                                                        if (record.decision == "通过") OkLight else ErrorLight,
                                                    ),
                                                contentAlignment = Alignment.Center,
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Filled.Check,
                                                    contentDescription = null,
                                                    tint = if (record.decision == "通过") Ok else Error,
                                                    modifier = Modifier.size(10.dp),
                                                )
                                            }
                                            Spacer(modifier = Modifier.width(8.dp))
                                            Column(modifier = Modifier.weight(1f)) {
                                                Text(
                                                    text = record.reviewerRole + " · " + record.decision,
                                                    fontSize = 12.sp,
                                                    color = Text1,
                                                )
                                                if (!record.comment.isNullOrBlank()) {
                                                    Text(
                                                        text = record.comment,
                                                        fontSize = 11.sp,
                                                        color = Text3,
                                                    )
                                                }
                                            }
                                            Text(
                                                text = record.reviewedAt.take(10),
                                                fontSize = 10.sp,
                                                color = Text3,
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        // 复述任务检验理解
                        AppCard {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Text(text = "复述任务（检验理解）", fontSize = 14.sp, color = Text1)
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = "用你自己的话说一遍这段内容在讲什么。",
                                    fontSize = 12.sp,
                                    color = Text2,
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                androidx.compose.material3.OutlinedTextField(
                                    value = recapText,
                                    onValueChange = { recapText = it },
                                    placeholder = { Text("我的复述…", color = Text3) },
                                    minLines = 2,
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                AppButton(
                                    text = if (recapDone) "已提交复述" else "提交复述",
                                    type = AppButtonType.Secondary,
                                    block = true,
                                    enabled = recapText.isNotBlank() && !recapDone,
                                    onClick = {
                                        recapDone = true
                                        toastText = "复述已记录，仅用于本机理解自检"
                                    },
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        // 举报入口
                        AppButton(
                            text = "内容有误？举报",
                            type = AppButtonType.Danger,
                            block = true,
                            onClick = {
                                scope.launch {
                                    try {
                                        handleResponse(
                                            feedbackApi.errorReport(
                                                mapOf(
                                                    "content_item_id" to d.id,
                                                    "category" to "内容有误",
                                                    "description" to "用户在 A15 提交的举报（自动附带内容版本 v" + (d.currentVersion?.version ?: 0) + "）",
                                                    "severity" to "medium",
                                                ),
                                            ),
                                        )
                                        toastText = "举报已提交，我们会尽快核实"
                                    } catch (e: Exception) {
                                        toastText = e.message ?: "举报提交失败，请稍后重试"
                                    }
                                }
                            },
                        )

                        Spacer(modifier = Modifier.height(16.dp))

                        Text(
                            text = d.disclaimer.ifBlank { "科普内容仅供参考，不作为诊断依据。" },
                            fontSize = 11.sp,
                            color = Text3,
                            lineHeight = 18.sp,
                        )

                        Spacer(modifier = Modifier.height(40.dp))
                    }
                }
            }
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
