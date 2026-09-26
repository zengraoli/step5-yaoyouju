package com.yaoyouju.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yaoyouju.android.ui.theme.Border
import com.yaoyouju.android.ui.theme.Error
import com.yaoyouju.android.ui.theme.ErrorLight
import com.yaoyouju.android.ui.theme.Info
import com.yaoyouju.android.ui.theme.InfoLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Warn
import com.yaoyouju.android.ui.theme.WarnLight

/**
 * 提示条（与 App 端一致）：
 * - Info 信息提示：说明服务边界与来源
 * - Warn 提醒：缺失不默认阴性
 * - Error 就医提示：红旗信号命中，不被任何流程阻断
 */
enum class NoticeType { Info, Warn, Error }

@Composable
fun AppNotice(
    type: NoticeType,
    modifier: Modifier = Modifier,
    text: String,
) {
    val (tint, background, icon) = when (type) {
        NoticeType.Info -> Triple(Info, InfoLight, Icons.Filled.Info)
        NoticeType.Warn -> Triple(Warn, WarnLight, Icons.Filled.Warning)
        NoticeType.Error -> Triple(Error, ErrorLight, Icons.Filled.Warning)
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(background)
            .padding(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = tint, modifier = Modifier.padding(top = 2.dp))
        Text(
            text = text,
            color = Text1,
            fontSize = 14.sp,
            modifier = Modifier
                .padding(start = 8.dp)
                .weight(1f),
        )
    }
}

/** 卡片（圆角 12dp，surface 底色，border 描边） */
@Composable
fun AppCard(
    modifier: Modifier = Modifier,
    background: Color = Surface,
    borderColor: Color = Border,
    padded: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .border(1.dp, borderColor, RoundedCornerShape(12.dp))
            .then(if (padded) Modifier.padding(16.dp) else Modifier),
        content = content,
    )
}
