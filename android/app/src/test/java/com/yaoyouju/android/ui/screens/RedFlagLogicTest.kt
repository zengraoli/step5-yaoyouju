package com.yaoyouju.android.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A02 关键变化确认 / A03 就医提示的单元测试。
 * 直接验证产品源码 RedFlagOptions（不复制一份实现），与服务端 RF-xx 规则一致。
 */
class RedFlagLogicTest {

    // ---------- 红旗判定 ----------

    @Test
    fun `三个高危选项均触发停止分析`() {
        assertTrue(RedFlagOptions.hasHighSeverity(setOf("bowel")))
        assertTrue(RedFlagOptions.hasHighSeverity(setOf("saddle")))
        assertTrue(RedFlagOptions.hasHighSeverity(setOf("legs")))
    }

    @Test
    fun `发热为中危不停止分析`() {
        assertFalse(RedFlagOptions.hasHighSeverity(setOf("fever")))
    }

    @Test
    fun `未选红旗不触发`() {
        assertFalse(RedFlagOptions.hasHighSeverity(emptySet()))
        assertFalse(RedFlagOptions.hasHighSeverity(setOf(RedFlagOptions.NONE_KEY)))
        assertFalse(RedFlagOptions.hasHighSeverity(setOf(RedFlagOptions.UNSURE_KEY)))
    }

    @Test
    fun `混合选择含高危即触发`() {
        assertTrue(RedFlagOptions.hasHighSeverity(setOf("fever", "saddle")))
    }

    // ---------- 信号名（A03 展示） ----------

    @Test
    fun `信号名与服务端规则一致`() {
        assertEquals(listOf("大小便控制变化"), RedFlagOptions.signalsOf(setOf("bowel")))
        assertEquals(listOf("会阴部麻木"), RedFlagOptions.signalsOf(setOf("saddle")))
        assertEquals(listOf("双腿进行性无力"), RedFlagOptions.signalsOf(setOf("legs")))
        assertEquals(listOf("伴发热"), RedFlagOptions.signalsOf(setOf("fever")))
    }

    @Test
    fun `多选信号按选项顺序`() {
        assertEquals(
            listOf("大小便控制变化", "会阴部麻木", "双腿进行性无力", "伴发热"),
            RedFlagOptions.signalsOf(setOf("fever", "legs", "saddle", "bowel")),
        )
    }

    // ---------- 触发文本（写入病程摘要，服务端同套规则校验） ----------

    @Test
    fun `触发文本可被服务端规则匹配`() {
        assertEquals(listOf("会阴部麻木"), RedFlagOptions.matchTextsOf(setOf("saddle")))
        assertEquals(listOf("腰痛伴发热"), RedFlagOptions.matchTextsOf(setOf("fever")))
        assertEquals(
            listOf("大小便控制变化", "会阴部麻木", "双腿进行性无力", "腰痛伴发热"),
            RedFlagOptions.matchTextsOf(setOf("bowel", "saddle", "legs", "fever")),
        )
    }

    // ---------- 互斥规则 ----------

    @Test
    fun `以上都没有与红旗选项互斥`() {
        var selected = setOf("saddle")
        selected = setOf(RedFlagOptions.NONE_KEY)
        assertTrue(selected.contains(RedFlagOptions.NONE_KEY))
        assertFalse(selected.contains("saddle"))
        assertFalse(RedFlagOptions.hasHighSeverity(selected))
    }

    @Test
    fun `勾选红旗时清空以上都没有`() {
        var selected = setOf(RedFlagOptions.NONE_KEY)
        selected = selected.toMutableSet().apply {
            remove(RedFlagOptions.NONE_KEY)
            remove(RedFlagOptions.UNSURE_KEY)
            add("legs")
        }
        assertTrue(selected.contains("legs"))
        assertFalse(selected.contains(RedFlagOptions.NONE_KEY))
        assertTrue(RedFlagOptions.hasHighSeverity(selected))
    }

    // ---------- A02 表单规则 ----------

    @Test
    fun `四道题全部有尚未确认选项`() {
        assertTrue(RedFlagOptions.changeOptions.contains("尚未确认"))
        assertTrue(RedFlagOptions.sideOptions.contains("尚未确认"))
        assertTrue(RedFlagOptions.onsetOptions.contains("尚未确认"))
    }

    @Test
    fun `起病时间快速选项写进起病日期`() {
        val inWeek = RedFlagOptions.onsetDateOf("约1周内")
        val inMonth = RedFlagOptions.onsetDateOf("约1个月内")
        val in3Month = RedFlagOptions.onsetDateOf("约3个月内")
        assertTrue(inWeek != null && Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(inWeek))
        assertTrue(inMonth != null && Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(inMonth))
        assertTrue(in3Month != null && Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(in3Month))
        // 快速选项给出的是大致日期：约1个月内比约1周内更早
        assertTrue(inMonth!! < inWeek!!)
        assertTrue(in3Month!! < inMonth!!)
    }

    @Test
    fun `记不清与尚未确认不写起病日期`() {
        assertNull(RedFlagOptions.onsetDateOf("记不清"))
        assertNull(RedFlagOptions.onsetDateOf("尚未确认"))
        assertNull(RedFlagOptions.onsetDateOf("更久 / 说不清"))
        assertNull(RedFlagOptions.onsetDateOf(null))
    }
}
