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
import com.yaoyouju.android.data.ServiceLocator
import kotlinx.coroutines.launch
import com.yaoyouju.android.ui.components.AppButton
import com.yaoyouju.android.ui.components.AppButtonType
import com.yaoyouju.android.ui.components.AppNotice
import com.yaoyouju.android.ui.components.NoticeType
import com.yaoyouju.android.ui.navigation.Routes
import com.yaoyouju.android.ui.theme.Border
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Text3

/**
 * A04 选择主要困惑（设计稿 docs/design/app/A04.png，宽度 375，第 2/4 步）
 *
 * 用户主动选择困扰点与解释方式；系统按选择调整解释的重点、长度和形式。
 * 选择只影响解释的呈现，不构成诊断，也不给用户贴标签。
 *
 * 数据说明：困惑与解释方式保存在本地（DataStore），供 A06 核对页展示；
 * 一页分析的生成由 server 完成（POST /analyses），本页不直接调用接口。
 */
@Composable
fun ConfusionScreen(navController: NavHostController) {
    val prefs = ServiceLocator.tokenStore

    // 四个主要困惑（文案按设计稿）
    data class Confusion(val key: String, val title: String, val desc: String)
    val confusions = listOf(
        Confusion("report", "报告术语", "看懂报告里写的是什么、哪些结论不能得出"),
        Confusion("course", "病程变化", "这段时间的变化意味着什么、哪些值得记录"),
        Confusion("followup", "复诊准备", "复诊时该问什么、带什么、怎么描述"),
        Confusion("life", "生活影响", "日常活动、工作与睡眠要注意什么"),
    )
    // 希望的解释方式（可多选；「简短要点」默认选中）
    val explainWays = listOf("简短要点", "详细说明", "带图示视频", "先看原文对照")

    var selected by remember { mutableStateOf<String?>(null) }
    var ways by remember { mutableStateOf(setOf("简短要点")) }
    val scope = rememberCoroutineScope()

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
            androidx.compose.material3.Icon(
                imageVector = Icons.Filled.ArrowBack,
                contentDescription = "返回",
                tint = Text1,
                modifier = Modifier
                    .size(28.dp)
                    .clickable { navController.popBackStack() },
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "选择主要困惑",
                fontSize = 17.sp,
                color = Text1,
                modifier = Modifier.weight(1f),
            )
            Text(text = "第 2/4 步", fontSize = 12.sp, color = Text2)
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "你最想弄清楚的是什么？我们会按你的选择调整解释的重点、长度和形式。选择只影响呈现方式，不构成诊断。",
                fontSize = 13.sp,
                color = Text2,
                lineHeight = 20.sp,
            )

            Spacer(modifier = Modifier.height(24.dp))
            Text(text = "主要困惑（单选）", fontSize = 15.sp, color = Text1)
            Spacer(modifier = Modifier.height(12.dp))

            confusions.forEach { item ->
                ConfusionCard(
                    title = item.title,
                    desc = item.desc,
                    selected = selected == item.key,
                    onClick = { selected = item.key },
                )
                Spacer(modifier = Modifier.height(10.dp))
            }

            Spacer(modifier = Modifier.height(16.dp))
            Text(text = "希望的解释方式（可多选）", fontSize = 15.sp, color = Text1)
            Spacer(modifier = Modifier.height(12.dp))

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                explainWays.chunked(2).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { way ->
                            val checked = ways.contains(way)
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
                                    .clickable {
                                        ways = if (checked) {
                                            ways - way
                                        } else {
                                            ways + way
                                        }
                                    }
                                    .padding(vertical = 12.dp, horizontal = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(18.dp)
                                        .clip(RoundedCornerShape(5.dp))
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
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(text = way, fontSize = 13.sp, color = Text1)
                            }
                        }
                        if (row.size == 1) Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            AppNotice(
                type = NoticeType.Info,
                text = "以上选择保存在本机，用于调整解释呈现；不涉及新的健康数据上传。",
            )

            Spacer(modifier = Modifier.height(24.dp))

            AppButton(
                text = "下一步：录入报告与医嘱",
                type = AppButtonType.Primary,
                block = true,
                onClick = {
                    // 保存到 DataStore（键 confusion / ways）
                    scope.launch {
                        prefs.savePreference("confusion", selected ?: "")
                        prefs.savePreference("ways", ways.joinToString(","))
                    }
                    navController.navigate(Routes.REPORT_INPUT)
                },
            )

            Spacer(modifier = Modifier.height(12.dp))

            AppButton(
                text = "跳过，直接生成一页分析",
                type = AppButtonType.Secondary,
                block = true,
                onClick = {
                    navController.navigate(Routes.ANALYSIS)
                },
            )

            Spacer(modifier = Modifier.height(40.dp))
        }
    }
}

/** 困惑卡片 */
@Composable
private fun ConfusionCard(
    title: String,
    desc: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) PrimaryLight else Surface)
            .then(
                if (selected) Modifier else Modifier.border(
                    1.dp,
                    Border,
                    RoundedCornerShape(12.dp),
                ),
            )
            .clickable { onClick() }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(if (selected) Primary else PrimaryLight),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = title.take(1),
                fontSize = 16.sp,
                color = if (selected) Surface else Primary,
            )
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, fontSize = 15.sp, color = Text1)
            Spacer(modifier = Modifier.height(2.dp))
            Text(text = desc, fontSize = 12.sp, color = Text2)
        }
        if (selected) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = null,
                tint = Primary,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}
