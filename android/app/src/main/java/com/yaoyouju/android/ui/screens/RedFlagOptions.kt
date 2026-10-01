package com.yaoyouju.android.ui.screens

/**
 * A02「当前关键变化确认」的红旗选项与表单规则（与 server 安全规则集 RF-xx 对应）。
 *
 * 单独成文件便于单元测试直接验证产品逻辑（不复制一份测试专用实现）：
 * - label：A02 里用户看到的选项文案
 * - signal：A03 就医提示展示的规范信号名（与服务端规则 label 一致）
 * - match：写入病程摘要、用于触发服务端红旗校验的文本
 * - severity：high = 停止个性化分析；medium = 提示就医（分析仍生成）
 */
data class RedFlagOption(
    val key: String,
    val label: String,
    val signal: String,
    val match: String,
    val severity: String,
)

object RedFlagOptions {
    val bowel = RedFlagOption("bowel", "大小便控制异常", "大小便控制变化", "大小便控制变化", "high")
    val saddle = RedFlagOption("saddle", "会阴区或鞍区麻木", "会阴部麻木", "会阴部麻木", "high")
    val legs = RedFlagOption("legs", "双腿进行性无力", "双腿进行性无力", "双腿进行性无力", "high")
    val fever = RedFlagOption(
        "fever",
        "发热、夜间痛持续不缓解或体重明显下降",
        "伴发热",
        "腰痛伴发热",
        "medium",
    )

    /** 第 2 题全部红旗选项（顺序即界面顺序） */
    val all: List<RedFlagOption> = listOf(bowel, saddle, legs, fever)

    const val NONE_KEY = "none"
    const val UNSURE_KEY = "unsure"

    /** 是否命中 high 级红旗（停止个性化分析） */
    fun hasHighSeverity(keys: Set<String>): Boolean =
        all.any { keys.contains(it.key) && it.severity == "high" }

    /** 已选选项 → 规范信号名（A03 展示） */
    fun signalsOf(keys: Set<String>): List<String> = all.filter { keys.contains(it.key) }.map { it.signal }

    /** 已选选项 → 触发服务端安全规则的文本（写入病程摘要） */
    fun matchTextsOf(keys: Set<String>): List<String> = all.filter { keys.contains(it.key) }.map { it.match }

    /**
     * 第 4 题快速选项 → 起病日期（YYYY-MM-DD）。
     * 「记不清 / 尚未确认」返回 null（缺失不默认阴性）。
     */
    fun onsetDateOf(option: String?): String? {
        if (option.isNullOrBlank() || option == "尚未确认" || option == "记不清" || option == "更久 / 说不清") {
            return null
        }
        val days = when (option) {
            "约1周内" -> 7
            "1-4 周" -> 14
            "约1个月内" -> 30
            "1-3 个月" -> 60
            "约3个月内" -> 90
            else -> return null
        }
        val cal = java.util.Calendar.getInstance()
        cal.add(java.util.Calendar.DAY_OF_YEAR, -days)
        val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
        return fmt.format(cal.time)
    }

    /** A02 四道题的选项（第 1/3/4 题） */
    val changeOptions: List<String> = listOf("加重", "差不多", "减轻", "尚未确认")
    val sideOptions: List<String> = listOf("左侧", "右侧", "双侧", "尚未确认")
    val onsetOptions: List<String> = listOf("约1周内", "约1个月内", "约3个月内", "更久 / 说不清", "尚未确认")
}
