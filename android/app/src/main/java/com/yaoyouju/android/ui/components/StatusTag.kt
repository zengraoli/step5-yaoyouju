package com.yaoyouju.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yaoyouju.android.ui.theme.Error
import com.yaoyouju.android.ui.theme.ErrorLight
import com.yaoyouju.android.ui.theme.Info
import com.yaoyouju.android.ui.theme.InfoLight
import com.yaoyouju.android.ui.theme.NeutralLight
import com.yaoyouju.android.ui.theme.Ok
import com.yaoyouju.android.ui.theme.OkLight
import com.yaoyouju.android.ui.theme.Text2
import com.yaoyouju.android.ui.theme.Warn
import com.yaoyouju.android.ui.theme.WarnLight

/**
 * 状态标签（三端语义完全一致，文案见 docs/design/README.md）：
 * 已确认 / 尚未确认 / 有冲突 / 未经核实 / 报告原文 / 自述 /
 * 系统生成 / 已审核 v2 / 已下线 · 更正中 / 不作诊断
 * 规则：未回答显示「尚未确认」，不显示「无」；报告未描述显示「报告未提及」，不显示「已排除」。
 */
enum class StatusKey {
    Confirmed, Unconfirmed, Conflict, Unverified, Quote, Self, Generated, Reviewed, Offline, NoDiagnosis
}

private data class StatusMeta(val text: String, val tone: Color, val background: Color)

private fun metaOf(key: StatusKey): StatusMeta = when (key) {
    StatusKey.Confirmed -> StatusMeta("已确认", Ok, OkLight)
    StatusKey.Unconfirmed -> StatusMeta("尚未确认", Warn, WarnLight)
    StatusKey.Conflict -> StatusMeta("有冲突", Error, ErrorLight)
    StatusKey.Unverified -> StatusMeta("未经核实", Warn, WarnLight)
    StatusKey.Quote -> StatusMeta("报告原文", Info, InfoLight)
    StatusKey.Self -> StatusMeta("自述", Text2, NeutralLight)
    StatusKey.Generated -> StatusMeta("系统生成", Text2, NeutralLight)
    StatusKey.Reviewed -> StatusMeta("已审核 v2", Ok, OkLight)
    StatusKey.Offline -> StatusMeta("已下线 · 更正中", Text2, NeutralLight)
    StatusKey.NoDiagnosis -> StatusMeta("不作诊断", Text2, NeutralLight)
}

@Composable
fun StatusTag(
    status: StatusKey,
    modifier: Modifier = Modifier,
    text: String? = null,
) {
    val meta = metaOf(status)
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(meta.background)
            .padding(horizontal = 8.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Text(
            text = text ?: meta.text,
            color = meta.tone,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}
