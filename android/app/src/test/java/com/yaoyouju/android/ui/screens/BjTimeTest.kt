package com.yaoyouju.android.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * BjTime 时间展示：服务端 UTC ISO8601 / 仅日期 YYYY-MM-DD / 空 都要正确（F12 第 3 条）。
 * 报告检查日期常是「仅日期」，不能因解析不了而误判成「尚未确认」。
 */
class BjTimeTest {
    @Test
    fun `完整时间戳按北京时间展示`() {
        // 2026-09-29T16:00:00Z → 北京时间 2026-09-30 00:00
        assertEquals("2026-09-30", BjTime.date("2026-09-29T16:00:00.000Z"))
    }

    @Test
    fun `仅日期YYYY-MM-DD原样展示`() {
        assertEquals("2026-09-30", BjTime.date("2026-09-30"))
    }

    @Test
    fun `空与非日期返回空串`() {
        assertEquals("", BjTime.date(null))
        assertEquals("", BjTime.date(""))
        assertEquals("", BjTime.date("尚未确认"))
    }
}
