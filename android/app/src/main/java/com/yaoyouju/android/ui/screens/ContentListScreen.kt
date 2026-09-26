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
import com.yaoyouju.android.core.net.ContentListItem2
import com.yaoyouju.android.core.net.ContentsApi2
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.handleResponse
import kotlinx.coroutines.launch
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

/**
 * A13 审核内容库（设计稿 docs/design/app/A13.png，宽度 375）
 *
 * 内容都经过临床审定；适用范围、版本、审核记录、下线开关可见；推荐理由可见；
 * 用户端只能看到已发布且未下线的内容（服务端已过滤）。
 *
 * 数据全部来自 server 接口：
 * - GET /contents       已发布内容列表（含推荐理由）
 * - GET /contents/{id}  详情（A15）
 */
@Composable
fun ContentListScreen(navController: NavHostController) {
    val contentsApi: ContentsApi2 = NetworkModule.api()

    // 筛选标签（按设计稿）
    val filters = listOf(
        "全部" to null,
        "报告术语" to "视频",
        "节段位置" to "图文",
        "医生会观察什么" to "案例",
        "信息来源怎么行" to "视频",
        "生活影响" to "图文",
    )
    var filter by remember { mutableStateOf(filters[0]) }
    var items by remember { mutableStateOf<List<ContentListItem2>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    val scope = rememberCoroutineScope()

    fun load() {
        loading = true
        scope.launch {
            try {
                items = handleResponse(contentsApi.list(filter.second))
            } catch (_: Exception) {
                items = emptyList()
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(filter) { load() }

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
                text = "审核内容库",
                fontSize = 20.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            Text(text = "已临床审定", fontSize = 11.sp, color = Text3)
        }

        // 筛选标签
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            filters.take(3).forEach { item ->
                FilterChip(
                    text = item.first,
                    selected = filter == item,
                    onClick = { filter = item },
                    modifier = Modifier.weight(1f),
                )
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            filters.drop(3).forEach { item ->
                FilterChip(
                    text = item.first,
                    selected = filter == item,
                    onClick = { filter = item },
                    modifier = Modifier.weight(1f),
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

                items.isEmpty() -> Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(text = "暂无内容", fontSize = 14.sp, color = Text2)
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "换一个筛选条件，或稍后再来。",
                        fontSize = 12.sp,
                        color = Text3,
                    )
                }

                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(items) { item ->
                        ContentCard(
                            item = item,
                            onClick = { navController.navigate(Routes.CONTENT_DETAIL + "?contentId=" + item.id) },
                        )
                    }
                }
            }
        }

        AppNotice(
            type = NoticeType.Info,
            text = "内容都经过临床审定；适用范围、版本与审核记录在详情页可见。",
            modifier = Modifier.padding(horizontal = 20.dp),
        )

        Spacer(modifier = Modifier.height(16.dp))
    }
}

/** 筛选芯片 */
@Composable
private fun FilterChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        fontSize = 11.sp,
        color = if (selected) Surface else Text2,
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) Primary else NeutralLight)
            .clickable { onClick() }
            .padding(vertical = 7.dp),
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
    )
}

/** 内容卡片 */
@Composable
private fun ContentCard(
    item: ContentListItem2,
    onClick: () -> Unit,
) {
    AppCard(modifier = Modifier.clickable { onClick() }) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = item.type,
                    fontSize = 10.sp,
                    color = Info,
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(InfoLight)
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = item.title,
                    fontSize = 14.sp,
                    color = Text1,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "适用：" + item.applicableScope,
                fontSize = 11.sp,
                color = Text3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "v" + (item.version ?: 0),
                    fontSize = 11.sp,
                    color = Text3,
                )
                Spacer(modifier = Modifier.width(8.dp))
                StatusTag(status = StatusKey.Reviewed)
            }
            if (item.recommendReason.isNotBlank()) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "推荐理由：" + item.recommendReason,
                    fontSize = 11.sp,
                    color = Primary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
