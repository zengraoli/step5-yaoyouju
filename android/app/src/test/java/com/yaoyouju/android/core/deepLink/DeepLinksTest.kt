package com.yaoyouju.android.core.deepLink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T43：deep link 解析（yaoyouju://A07 → analysis 路由）。
 */
class DeepLinksTest {

    @Test
    fun `解析页面编号到路由`() {
        val target = DeepLinks.parse("yaoyouju://A07")
        assertEquals("A07", target?.code)
        assertEquals("analysis", target?.route)
    }

    @Test
    fun `小写编号同样可用`() {
        val target = DeepLinks.parse("yaoyouju://a10")
        assertEquals("timeline", target?.route)
    }

    @Test
    fun `带查询参数时透传`() {
        val target = DeepLinks.parse("yaoyouju://A08?index=0")
        assertEquals("report_diff", target?.route)
        assertEquals("0", target?.param("index"))
        assertNull(target?.param("missing"))
    }

    @Test
    fun `未知编号返回 null`() {
        assertNull(DeepLinks.parse("yaoyouju://A99"))
        assertNull(DeepLinks.parse("yaoyouju://"))
        assertNull(DeepLinks.parse(null))
        assertNull(DeepLinks.parse("https://example.com/A07"))
    }

    @Test
    fun `A01 到 A18 全部有映射`() {
        val codes = DeepLinks.supportedCodes()
        for (code in listOf("A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10", "A11", "A12", "A13", "A15", "A16", "A17", "A18")) {
            assertTrue("缺少 $code 的 deep link 映射", codes.contains(code))
        }
    }

    @Test
    fun `路由与 Routes 表一致`() {
        assertEquals("login", DeepLinks.parse("yaoyouju://A01")?.route)
        assertEquals("emergency", DeepLinks.parse("yaoyouju://A03")?.route)
        assertEquals("fallback", DeepLinks.parse("yaoyouju://A18")?.route)
    }
}
