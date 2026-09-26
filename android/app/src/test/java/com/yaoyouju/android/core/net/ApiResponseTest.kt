package com.yaoyouju.android.core.net

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T43：统一响应格式解析（{code, data, message}）与业务错误透出。
 */
class ApiResponseTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test
    fun `解析成功响应`() {
        val raw = """{"code":0,"data":{"id":"u1","phone_masked":"138****1234"},"message":"ok"}"""
        val resp = json.decodeFromString<ApiResponse<LoginUser>>(raw)
        assertEquals(0, resp.code)
        assertEquals("u1", resp.data?.id)
        assertEquals("138****1234", resp.data?.phoneMasked)
    }

    @Test
    fun `解析业务错误响应`() {
        val raw = """{"code":40911,"data":null,"message":"会阴部麻木需要尽快由医生评估，请前往医院就诊。"}"""
        val resp = json.decodeFromString<ApiResponse<LoginUser>>(raw)
        assertEquals(40911, resp.code)
        assertNull(resp.data)
        assertTrue(resp.message.contains("就诊"))
    }

    @Test
    fun `解析就医提示结构化 data`() {
        val raw = """{"code":40910,"data":{"title":"需要及时寻求专业帮助","headline":"建议及时就医评估","body":"x","offline_note":"y","footer_note":"z","matched":[{"rule_code":"RF-05","label":"伴发热","severity":"medium","action":"提示就医","advice":"腰痛伴发热建议及时就医评估。"}]},"message":"m"}"""
        val resp = json.decodeFromString<ApiResponse<JsonObject>>(raw)
        val data = resp.data!!
        val notice = json.decodeFromString<EmergencyNotice>(data.toString())
        assertEquals("建议及时就医评估", notice.headline)
        assertEquals(1, notice.matched.size)
        assertEquals("RF-05", notice.matched[0].ruleCode)
        assertEquals("提示就医", notice.matched[0].action)
    }

    @Test
    fun `解析功能开关列表`() {
        val raw = """{"code":0,"data":[{"key":"个性化分析","enabled":true},{"key":"案例卡片","enabled":false}]}"""
        val resp = json.decodeFromString<ApiResponse<List<SwitchState>>>(raw)
        assertEquals(2, resp.data?.size)
        assertEquals(true, resp.data?.get(0)?.enabled)
        assertEquals(false, resp.data?.get(1)?.enabled)
    }

    @Test
    fun `解析同意记录（含下划线字段名）`() {
        val raw = """{"code":0,"data":[{"id":"c1","scope":"健康信息处理","granted":true,"granted_at":"2026-09-01T10:12:00.000Z","revoked_at":null}]}"""
        val resp = json.decodeFromString<ApiResponse<List<ConsentItem>>>(raw)
        val item = resp.data!!.first()
        assertEquals("健康信息处理", item.scope)
        assertEquals(true, item.granted)
        assertEquals("2026-09-01T10:12:00.000Z", item.grantedAt)
        assertNull(item.revokedAt)
    }
}
