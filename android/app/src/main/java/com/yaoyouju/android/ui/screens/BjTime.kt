package com.yaoyouju.android.ui.screens

import java.time.Instant
import java.time.ZoneId
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * 时间展示工具：服务端一律 UTC ISO8601 存储，界面按北京时间（UTC+8）展示（docs/brief.md 全局约定）。
 * 早期版本直接截取 ISO 字符串前 10 位，那拿的是 UTC 日期，晚 8 小时的记录会差一天
 * （验收反馈：核对页报告日期显示 2026-09-19，实际是 2026-09-20）。
 */
object BjTime {
    private val ZONE: ZoneId = ZoneId.of("Asia/Shanghai")
    private val DATE_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    private val DATETIME_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

    /** UTC ISO8601 → 北京时间日期（YYYY-MM-DD）；空 / 非法返回空串 */
    fun date(iso: String?): String {
        val instant = parse(iso) ?: return ""
        return DATE_FMT.format(instant.atZone(ZONE))
    }

    /** UTC ISO8601 → 北京时间日期 + 时分；空 / 非法返回空串 */
    fun dateTime(iso: String?): String {
        val instant = parse(iso) ?: return ""
        return DATETIME_FMT.format(instant.atZone(ZONE))
    }

    private fun parse(iso: String?): Instant? {
        if (iso.isNullOrBlank()) return null
        return try {
            Instant.parse(iso)
        } catch (_: Exception) {
            // 支持「仅日期 YYYY-MM-DD」（如报告检查日期）：按当天零点解析，
            // 不再因 Instant.parse 只接受完整时间戳而把明确日期误判成「尚未确认」（F12 第 3 条）
            try {
                LocalDate.parse(iso.trim()).atStartOfDay(ZoneOffset.UTC).toInstant()
            } catch (_: Exception) {
                null
            }
        }
    }
}
