package com.yaoyouju.android.ui.screens

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavHostController
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot

/**
 * T50：A01–A18 全页面 Roborazzi 截图测试（Robolectric + Compose）。
 *
 * 运行方式（生成 / 更新截图）：
 * ```
 * cd android
 * gradlew.bat recordRoborazziDebug
 * ```
 * 截图输出到 `android/screenshots/`（构建产物之外，随仓库提交）。
 * 校验方式（不重新录制，仅比对）：
 * ```
 * gradlew.bat verifyRoborazziDebug
 * ```
 *
 * 说明：数据来自 server 接口的页面，在无网络的 Robolectric 环境中
 * 会渲染其空态 / 加载态 / 静态兜底内容（就医提示等内容本就常驻）。
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = RobolectricDeviceQualifiers.MediumPhone)
class ScreenShotsTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun navController(): NavHostController {
        val context: Context = ApplicationProvider.getApplicationContext()
        return NavHostController(context)
    }

    /** 渲染一个页面并截图 */
    private fun shoot(name: String, content: @Composable (NavHostController) -> Unit) {
        composeRule.setContent {
            val nav = remember { navController() }
            content(nav)
        }
        composeRule.onRoot().captureRoboImage(filePath = "../screenshots/$name.png")
    }

    @Test
    fun a01_login() = shoot("A01-登录授权") { LoginScreen(it) }

    @Test
    fun a02_change() = shoot("A02-关键变化确认") { ChangeScreen(it) }

    @Test
    fun a03_emergency() = shoot("A03-就医提示") {
        EmergencyScreen(navController = it, signals = "会阴部麻木", stop = true)
    }

    @Test
    fun a04_confusion() = shoot("A04-选择主要困惑") { ConfusionScreen(it) }

    @Test
    fun a05_report_input() = shoot("A05-录入报告与医嘱") { ReportInputScreen(it) }

    @Test
    fun a06_report_verify() = shoot("A06-核对结构化信息") { ReportVerifyScreen(it) }

    @Test
    fun a07_analysis() = shoot("A07-一页理性分析") { AnalysisScreen(navController = it) }

    @Test
    fun a08_report_diff() = shoot("A08-原文对照") { ReportDiffScreen(navController = it) }

    @Test
    fun a09_qa() = shoot("A09-问与解释") { QaScreen(it) }

    @Test
    fun a10_timeline() = shoot("A10-病程时间线") { TimelineScreen(it) }

    @Test
    fun a11_today() = shoot("A11-记录今天") { TodayScreen(it) }

    @Test
    fun a12_followup() = shoot("A12-复诊摘要") { FollowupScreen(it) }

    @Test
    fun a13_contents() = shoot("A13-审核内容库") { ContentListScreen(it) }

    @Test
    fun a15_content_detail() = shoot("A15-视频详情") { ContentDetailScreen(navController = it) }

    @Test
    fun a16_feedback() = shoot("A16-反馈与举报") { FeedbackScreen(navController = it) }

    @Test
    fun a17_mine() = shoot("A17-我的") { MineScreen(it) }

    @Test
    fun a18_fallback() = shoot("A18-服务不可用回退") { FallbackScreen(navController = it) }
}
