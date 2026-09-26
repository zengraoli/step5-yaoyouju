package com.yaoyouju.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.yaoyouju.android.ui.theme.Border
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface
import com.yaoyouju.android.ui.theme.Text1
import com.yaoyouju.android.ui.theme.Text2

/**
 * 芯片（与 App 端一致）：
 * - Selected 已选：主色实底白字（A02 设计稿）
 * - Unselected 未选：描边浅底
 * - Skip 跳过：中性色（“跳过 / 尚未确认”）
 * 最小点击区域 48dp；圆角胶囊。
 */
enum class ChipState { Selected, Unselected, Skip }

@Composable
fun AppChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    skip: Boolean = false,
    enabled: Boolean = true,
) {
    val state = when {
        skip -> ChipState.Skip
        selected -> ChipState.Selected
        else -> ChipState.Unselected
    }
    val background = when (state) {
        ChipState.Selected -> Primary
        ChipState.Unselected -> Surface
        ChipState.Skip -> Surface
    }
    val contentColor = when (state) {
        ChipState.Selected -> Surface
        ChipState.Unselected -> Text1
        ChipState.Skip -> Text2
    }
    val borderColor = when (state) {
        ChipState.Selected -> Primary
        ChipState.Unselected -> Border
        ChipState.Skip -> Border
    }

    Row(
        modifier = modifier
            .defaultMinSize(minHeight = 48.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, borderColor, RoundedCornerShape(999.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (state == ChipState.Selected) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = null,
                tint = Surface,
                modifier = Modifier
                    .size(16.dp)
                    .padding(end = 0.dp),
            )
        }
        Text(text = text, color = contentColor)
    }
}

/** 单选芯片组（用于“今天能坐多久”等单选场景；-1 表示未选择） */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AppChipGroup(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    skipIndices: Set<Int> = emptySet(),
) {
    androidx.compose.foundation.layout.FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        options.forEachIndexed { index, option ->
            AppChip(
                text = option,
                selected = selectedIndex == index,
                skip = index in skipIndices,
                onClick = { onSelect(if (selectedIndex == index) -1 else index) },
            )
        }
    }
}

/** 通用小色块提示（用于图例） */
@Composable
fun LegendDot(color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(10.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(color),
    )
}
