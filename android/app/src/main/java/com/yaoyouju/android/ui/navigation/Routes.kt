package com.yaoyouju.android.ui.navigation

/**
 * 应用内路由表（与 DeepLinks 映射一致）。
 * 底部导航五个入口：当前情况 / 问与解释 / 病程 / 复诊准备 / 我的。
 */
object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val CHANGE = "change"
    const val EMERGENCY = "emergency"
    const val CONFUSION = "confusion"
    const val REPORT_INPUT = "report_input"
    const val REPORT_VERIFY = "report_verify"
    const val ANALYSIS = "analysis"
    const val REPORT_DIFF = "report_diff"
    const val QA = "qa"
    const val TIMELINE = "timeline"
    const val TODAY = "today"
    const val FOLLOWUP = "followup"
    const val CONTENTS = "contents"
    const val CONTENT_DETAIL = "content_detail"
    const val FEEDBACK = "feedback"
    const val MINE = "mine"
    const val FALLBACK = "fallback"

    /** 底部导航（顺序与设计规范一致） */
    val BOTTOM_TABS = listOf(
        BottomTab(HOME, "当前情况"),
        BottomTab(QA, "问与解释"),
        BottomTab(TIMELINE, "病程"),
        BottomTab(FOLLOWUP, "复诊准备"),
        BottomTab(MINE, "我的"),
    )

    data class BottomTab(val route: String, val label: String)
}
