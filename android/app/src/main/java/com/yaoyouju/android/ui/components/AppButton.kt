package com.yaoyouju.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.yaoyouju.android.ui.theme.Error
import com.yaoyouju.android.ui.theme.ErrorLight
import com.yaoyouju.android.ui.theme.Primary
import com.yaoyouju.android.ui.theme.PrimaryLight
import com.yaoyouju.android.ui.theme.Surface

/**
 * 通用按钮（与 App 端一致）：
 * - Primary 主按钮：主操作
 * - Secondary 次按钮：描边
 * - Soft 柔和：浅底
 * - Danger 危险 / 就医：红色实底
 * 最小点击区域 48dp（≥44×44），圆角 10dp。
 */
enum class AppButtonType { Primary, Secondary, Soft, Danger }

@Composable
fun AppButton(
    text: String,
    modifier: Modifier = Modifier,
    type: AppButtonType = AppButtonType.Primary,
    enabled: Boolean = true,
    loading: Boolean = false,
    block: Boolean = false,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(10.dp)
    val baseModifier = modifier
        .defaultMinSize(minHeight = 48.dp)
        .then(if (block) Modifier.fillMaxWidth() else Modifier)

    when (type) {
        AppButtonType.Primary -> Button(
            onClick = onClick,
            enabled = enabled && !loading,
            shape = shape,
            modifier = baseModifier,
            colors = ButtonDefaults.buttonColors(containerColor = Primary, contentColor = Surface),
        ) { ButtonContent(text, loading, Surface) }

        AppButtonType.Danger -> Button(
            onClick = onClick,
            enabled = enabled && !loading,
            shape = shape,
            modifier = baseModifier,
            colors = ButtonDefaults.buttonColors(containerColor = Error, contentColor = Surface),
        ) { ButtonContent(text, loading, Surface) }

        AppButtonType.Secondary -> OutlinedButton(
            onClick = onClick,
            enabled = enabled && !loading,
            shape = shape,
            modifier = baseModifier,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Primary),
        ) { ButtonContent(text, loading, Primary) }

        AppButtonType.Soft -> Button(
            onClick = onClick,
            enabled = enabled && !loading,
            shape = shape,
            modifier = baseModifier,
            colors = ButtonDefaults.buttonColors(containerColor = PrimaryLight, contentColor = Primary),
        ) { ButtonContent(text, loading, Primary) }
    }
}

@Composable
private fun ButtonContent(text: String, loading: Boolean, contentColor: Color) {
    if (loading) {
        CircularProgressIndicator(
            modifier = Modifier.size(20.dp),
            color = contentColor,
            strokeWidth = 2.dp,
        )
    } else {
        Text(text = text)
    }
}

/**
 * 文字按钮（“跳过，先不录入”等次要操作；最小点击区域 48dp）
 */
@Composable
fun AppTextButton(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Primary,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .defaultMinSize(minHeight = 48.dp)
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = text, color = color)
    }
}

/** 图标按钮（导航栏动作；最小点击区域 48dp） */
@Composable
fun AppIconButton(
    icon: @Composable () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    size: Dp = 48.dp,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            icon()
        }
    }
}

/** 就医入口（红色横条）：全局可达，不被登录 / 付费 / 上传阻断 */
@Composable
fun EmergencyEntry(
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 48.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(ErrorLight)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "出现严重症状？无需登录，立即查看就医提示",
            color = Error,
        )
    }
}
