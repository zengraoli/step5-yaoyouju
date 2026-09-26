package com.yaoyouju.android.core.deepLink

/**
 * Deep link 映射：yaoyouju://<页面编号>（如 yaoyouju://A07）→ 应用内路由。
 * 编号对应 docs/design/app/ 的设计稿编号（A01–A18），测试时用 adb 直接打开页面：
 *   adb shell am start -a android.intent.action.VIEW -d "yaoyouju://A07"
 */
object DeepLinks {

    /** 设计稿编号 → 路由（与 Routes.kt 保持一致） */
    private val ROUTES: Map<String, String> = mapOf(
        "A01" to "login",
        "A02" to "change",
        "A03" to "emergency",
        "A04" to "confusion",
        "A05" to "report_input",
        "A06" to "report_verify",
        "A07" to "analysis",
        "A08" to "report_diff",
        "A09" to "qa",
        "A10" to "timeline",
        "A11" to "today",
        "A12" to "followup",
        "A13" to "contents",
        "A15" to "content_detail",
        "A16" to "feedback",
        "A17" to "mine",
        "A18" to "fallback",
    )

    /** 解析 deep link URI（yaoyouju://A07?index=0）→ 路由 + 参数 */
    fun parse(uri: String?): DeepLinkTarget? {
        if (uri.isNullOrBlank()) return null
        val match = Regex("^yaoyouju://([A-Za-z0-9]+)").find(uri.trim()) ?: return null
        val code = match.groupValues[1].uppercase()
        val route = ROUTES[code] ?: return null
        // 查询参数（如 ?index=0）原样透传
        val queryStart = uri.indexOf('?')
        val params = if (queryStart >= 0) uri.substring(queryStart + 1) else ""
        return DeepLinkTarget(code = code, route = route, params = params)
    }

    data class DeepLinkTarget(
        /** 设计稿编号（A01–A18） */
        val code: String,
        /** 应用内路由名 */
        val route: String,
        /** 查询参数字符串（key=value&...） */
        val params: String,
    ) {
        /** 取查询参数值 */
        fun param(key: String): String? =
            params.split('&')
                .map { it.split('=', limit = 2) }
                .firstOrNull { it.size == 2 && it[0] == key }
                ?.get(1)
    }

    /** 全部支持的编号（供测试与 README 使用） */
    fun supportedCodes(): List<String> = ROUTES.keys.sorted()
}
