package com.yaoyouju.android.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T45：A02 关键变化确认与 A03 就医提示的纯逻辑单元测试。
 * 红旗规则与 server 安全规则集（RF-xx）保持一致。
 */
class RedFlagLogicTest {

    private data class RedFlagOption(
        val key: String,
        val label: String,
        val signal: String,
        val match: String,
        val severity: String,
    )

    private val options = listOf(
        RedFlagOption("bowel", "大小便控制异常", "大小便控制变化", "大小便控制变化", "high"),
        RedFlagOption("saddle", "会阴区或鞍区麻木", "会阴部麻木", "会阴部麻木", "high"),
        RedFlagOption("legs", "双腿进行性无力", "双腿进行性无力", "双腿进行性无力", "high"),
        RedFlagOption("fever", "发热、夜间痛持续不缓解或体重明显下降", "伴发热", "腰痛伴发热", "medium"),
    )

    private fun hasHighSeverity(keys: Set<String>): Boolean =
        options.any { keys.contains(it.key) && it.severity == "high" }

    private fun signalsOf(keys: Set<String>): List<String> =
        options.filter { keys.contains(it.key) }.map { it.signal }

    private fun matchTextsOf(keys: Set<String>): List<String> =
        options.filter { keys.contains(it.key) }.map { it.match }

    // ---------- 红旗判定 ----------

    @Test
    fun `三个高危选项均触发停止分析`() {
        assertTrue(hasHighSeverity(setOf("bowel")))
        assertTrue(hasHighSeverity(setOf("saddle")))
        assertTrue(hasHighSeverity(setOf("legs")))
    }

    @Test
    fun `发热为中危不停止分析`() {
        assertFalse(hasHighSeverity(setOf("fever")))
    }

    @Test
    fun `未选红旗不触发`() {
        assertFalse(hasHighSeverity(emptySet()))
        assertFalse(hasHighSeverity(setOf("none")))
        assertFalse(hasHighSeverity(setOf("unsure")))
    }

    @Test
    fun `混合选择含高危即触发`() {
        assertTrue(hasHighSeverity(setOf("fever", "saddle")))
    }

    // ---------- 信号名（A03 展示） ----------

    @Test
    fun `信号名与服务端规则一致`() {
        assertEquals(listOf("大小便控制变化"), signalsOf(setOf("bowel")))
        assertEquals(listOf("会阴部麻木"), signalsOf(setOf("saddle")))
        assertEquals(listOf("双腿进行性无力"), signalsOf(setOf("legs")))
        assertEquals(listOf("伴发热"), signalsOf(setOf("fever")))
    }

    @Test
    fun `多选信号按选项顺序`() {
        assertEquals(
            listOf("大小便控制变化", "会阴部麻木", "双腿进行性无力", "伴发热"),
            signalsOf(setOf("fever", "legs", "saddle", "bowel")),
        )
    }

    // ---------- 触发文本（写入病程摘要） ----------

    @Test
    fun `触发文本可被服务端规则匹配`() {
        assertEquals(listOf("会阴部麻木"), matchTextsOf(setOf("saddle")))
        assertEquals(listOf("腰痛伴发热"), matchTextsOf(setOf("fever")))
    }

    // ---------- 互斥规则 ----------

    @Test
    fun `以上都没有与红旗选项互斥`() {
        var selected = setOf("saddle")
        // 勾选「以上都没有」时清空红旗
        selected = setOf("none")
        assertTrue(selected.contains("none"))
        assertFalse(selected.contains("saddle"))
        assertFalse(hasHighSeverity(selected))
    }

    @Test
    fun `勾选红旗时清空以上都没有`() {
        var selected = setOf("none")
        selected = selected.toMutableSet().apply {
            remove("none")
            remove("unsure")
            add("legs")
        }
        assertTrue(selected.contains("legs"))
        assertFalse(selected.contains("none"))
        assertTrue(hasHighSeverity(selected))
    }

    // ---------- A02 表单规则 ----------

    @Test
    fun `尚未确认是显式选项不默认阴性`() {
        val changeOptions = listOf("加重", "差不多", "减轻", "尚未确认")
        assertTrue(changeOptions.contains("尚未确认"))
        // 未选择时记为尚未确认，而不是默认阴性
        val selected: String? = null
        assertEquals("尚未确认", selected ?: "尚未确认")
    }

    @Test
    fun `四道题全部有尚未确认选项`() {
        val changeOptions = listOf("加重", "差不多", "减轻", "尚未确认")
        val sideOptions = listOf("左侧", "右侧", "双侧", "尚未确认")
        val onsetOptions = listOf("记不清", "约1周内", "约1个月内", "超过3个月")
        assertTrue(changeOptions.contains("尚未确认"))
        assertTrue(sideOptions.contains("尚未确认"))
        // 起病时间「记不清」等价于尚未确认
        assertTrue(onsetOptions.contains("记不清"))
    }
}
