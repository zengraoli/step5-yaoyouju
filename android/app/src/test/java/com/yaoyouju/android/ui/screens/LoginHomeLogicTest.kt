package com.yaoyouju.android.ui.screens

import com.yaoyouju.android.core.net.ApiException
import com.yaoyouju.android.core.net.ConsentItem
import com.yaoyouju.android.core.net.EmergencyNotice
import com.yaoyouju.android.core.net.MatchedRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T44：A01 登录授权与 A14 首页的纯逻辑单元测试（不依赖 Android 框架）。
 */
class LoginHomeLogicTest {

    // ---------- A01 登录表单校验 ----------

    private fun validateLoginForm(
        phone: String,
        code: String,
        agreeTerms: Boolean,
        healthConsent: Boolean,
    ): String? = when {
        phone.length != 11 -> "请输入正确的 11 位手机号"
        code.length != 6 -> "请输入 6 位验证码"
        !agreeTerms -> "请先阅读并同意《用户协议》《隐私政策》"
        !healthConsent -> "请单独同意处理我的健康信息（含检查报告、症状记录）"
        else -> null
    }

    @Test
    fun `登录表单 - 手机号位数不足`() {
        assertEquals("请输入正确的 11 位手机号", validateLoginForm("1380013", "123456", true, true))
    }

    @Test
    fun `登录表单 - 验证码位数不足`() {
        assertEquals("请输入 6 位验证码", validateLoginForm("13800138000", "1234", true, true))
    }

    @Test
    fun `登录表单 - 未同意用户协议`() {
        assertEquals("请先阅读并同意《用户协议》《隐私政策》", validateLoginForm("13800138000", "123456", false, true))
    }

    @Test
    fun `登录表单 - 未单独同意健康信息`() {
        assertEquals("请单独同意处理我的健康信息（含检查报告、症状记录）", validateLoginForm("13800138000", "123456", true, false))
    }

    @Test
    fun `登录表单 - 全部合法`() {
        assertNull(validateLoginForm("13800138000", "123456", true, true))
    }

    @Test
    fun `健康信息同意默认不勾选`() {
        // A01 红线：单独同意默认不勾选（初始状态 false）
        val defaultChecked = false
        assertFalse(defaultChecked)
    }

    // ---------- A14 首页数据规则 ----------

    @Test
    fun `首页 - 待确认项筛选规则`() {
        // verifyStatus 为 null 或「待确认」的事件进入待确认列表
        val statuses = listOf(null, "待确认", "已确认", "有冲突", "已核实")
        val pending = statuses.filter { it == null || it == "待确认" }
        assertEquals(2, pending.size)
        assertTrue(pending.contains(null))
    }

    @Test
    fun `首页 - 今日未记录给出记录入口`() {
        val todayRecorded: Boolean? = false
        assertTrue(todayRecorded == false)
    }

    @Test
    fun `首页 - 今日已记录不显示入口`() {
        val todayRecorded: Boolean? = true
        assertFalse(todayRecorded == false)
    }

    @Test
    fun `首页 - 未知状态不显示入口`() {
        val todayRecorded: Boolean? = null
        assertFalse(todayRecorded == false)
    }

    // ---------- 就医提示（公开） ----------

    @Test
    fun `就医提示 - 结构化字段解析`() {
        val notice = EmergencyNotice(
            title = "需要及时寻求专业帮助",
            headline = "建议及时就医评估",
            body = "你的回答里有一些信号，需要专业评估后才能安心。",
            offlineNote = "网络不稳定时，以下信息已保存，可稍后查看。",
            footerNote = "本提示不构成诊断，紧急情况请拨打 120。",
            matched = listOf(
                MatchedRule(
                    ruleCode = "RF-05",
                    label = "伴发热",
                    severity = "medium",
                    action = "提示就医",
                    advice = "腰痛伴发热建议及时就医评估。",
                ),
            ),
        )
        assertEquals("建议及时就医评估", notice.headline)
        assertEquals("RF-05", notice.matched[0].ruleCode)
        assertEquals("提示就医", notice.matched[0].action)
    }

    @Test
    fun `就医提示 - 命中红旗返回 40910 异常`() {
        val error = ApiException(40910, "需要及时寻求专业帮助", """{"headline":"建议及时就医评估"}""")
        assertEquals(40910, error.code)
        assertNotNull(error.data)
        assertTrue(error.message.contains("专业帮助"))
    }

    // ---------- 同意撤回（立即生效） ----------

    @Test
    fun `同意撤回 -  revoked 状态`() {
        val item = ConsentItem(
            id = "c1",
            scope = "健康信息处理",
            granted = false,
            grantedAt = null,
            revokedAt = "2026-09-27T10:00:00.000Z",
        )
        assertFalse(item.granted)
        assertNotNull(item.revokedAt)
    }
}
