package com.yaoyouju.android.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Material 3 主题（按 docs/design/README.md 设计规范）：
 * - 色彩令牌见 Color.kt；圆角：卡片 12 / 按钮 10 / 标签 4；
 * - 字体层级：页面标题 17 Medium、卡片标题 15 Medium、正文 14 Regular（行高 1.5–1.6）、
 *   辅助说明 12–13、标签 11–12 Medium；
 * - 字体使用系统栈（不加载外部资源）。
 */
private val YyjColorScheme = lightColorScheme(
    primary = Primary,
    onPrimary = Surface,
    primaryContainer = PrimaryLight,
    onPrimaryContainer = Primary,
    secondary = Primary,
    onSecondary = Surface,
    background = Bg,
    onBackground = Text1,
    surface = Surface,
    onSurface = Text1,
    surfaceVariant = NeutralLight,
    onSurfaceVariant = Text2,
    outline = Border,
    outlineVariant = Border,
    error = Error,
    onError = Surface,
    errorContainer = ErrorLight,
    onErrorContainer = Error,
)

private val YyjShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),   // 标签
    small = RoundedCornerShape(10.dp),       // 按钮
    medium = RoundedCornerShape(12.dp),      // 卡片
    large = RoundedCornerShape(16.dp),
)

private val YyjTypography = Typography(
    titleLarge = TextStyle(
        fontSize = 17.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 24.sp,
        color = Text1,
    ),
    titleMedium = TextStyle(
        fontSize = 15.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 22.sp,
        color = Text1,
    ),
    bodyLarge = TextStyle(
        fontSize = 14.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 22.sp,
        color = Text1,
    ),
    bodyMedium = TextStyle(
        fontSize = 14.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 21.sp,
        color = Text1,
    ),
    bodySmall = TextStyle(
        fontSize = 12.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 18.sp,
        color = Text2,
    ),
    labelLarge = TextStyle(
        fontSize = 14.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 20.sp,
    ),
    labelMedium = TextStyle(
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 16.sp,
    ),
    labelSmall = TextStyle(
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 15.sp,
    ),
)

@Composable
fun YaoyoujuTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = YyjColorScheme,
        typography = YyjTypography,
        shapes = YyjShapes,
        content = content,
    )
}
