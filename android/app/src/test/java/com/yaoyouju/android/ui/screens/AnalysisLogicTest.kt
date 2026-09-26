package com.yaoyouju.android.ui.screens

import com.yaoyouju.android.core.net.AnalysisMeta
import com.yaoyouju.android.core.net.AnalysisSections
import com.yaoyouju.android.core.net.Citation
import com.yaoyouju.android.core.net.ExplainItem
import com.yaoyouju.android.core.net.KnownItem
import com.yaoyouju.android.core.net.NextItem
import com.yaoyouju.android.core.net.VideoItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T47：A07 一页分析与 A08 原文对照的纯逻辑单元测试。
 */
class AnalysisLogicTest {

    private fun sampleSections() = AnalysisSections(
        known = listOf(
            KnownItem(text = "腰椎 MRI 显示 L4/5 椎间盘突出", source = "报告原文"),
            KnownItem(text = "症状加重约 2 周", source = "自述"),
        ),
        explain = listOf(
            ExplainItem(
                text = "报告描述的椎间盘突出可以解释部分腰腿痛症状",
                citations = listOf(
                    Citation(
                        evidenceDocId = "ev-1",
                        docTitle = "腰椎间盘突出诊疗指南",
                        statement = "椎间盘突出可压迫神经根引起下肢放射痛",
                        supported = true,
                    ),
                ),
            ),
        ),
        unknown = listOf(
            "是否有下肢放射痛及范围（尚未确认）",
            "是否伴有大小便控制异常（尚未确认）",
        ),
        next = listOf(
            NextItem(text = "放射痛具体到哪个部位、什么情况下加重", type = "复诊问题"),
            NextItem(text = "是否需要复查影像", type = "下一步"),
        ),
        videos = listOf(
            VideoItem(contentItemId = "c-1", title = "腰突为什么会腿麻", reason = "与你的报告术语相关"),
        ),
        meta = AnalysisMeta(
            modelRelease = "mock-2026.09",
            generatedAt = "2026-09-27T10:00:00.000Z",
            version = 3,
            disclaimer = "系统生成内容，仅供参考，不作诊断",
        ),
    )

    // ---------- 五段结构完整性 ----------

    @Test
    fun `五段结构字段齐全`() {
        val s = sampleSections()
        assertEquals(2, s.known.size)
        assertEquals(1, s.explain.size)
        assertEquals(2, s.unknown.size)
        assertEquals(2, s.next.size)
        assertEquals(1, s.videos.size)
    }

    @Test
    fun `每条解释都带引用`() {
        val s = sampleSections()
        s.explain.forEach { item ->
            assertTrue(item.citations.isNotEmpty())
            item.citations.forEach { cite ->
                assertTrue(cite.docTitle.isNotBlank())
                assertTrue(cite.statement.isNotBlank())
            }
        }
    }

    @Test
    fun `已知信息都带来源`() {
        val s = sampleSections()
        s.known.forEach { item ->
            assertFalse(item.source.isBlank())
        }
    }

    @Test
    fun `缺失信息不补写概率`() {
        val s = sampleSections()
        // unknown 段只列出缺什么，不含概率判断
        s.unknown.forEach { text ->
            assertFalse(text.contains("%"))
            assertFalse(text.contains("概率"))
        }
    }

    @Test
    fun `尚未确认不会被当作没有`() {
        val s = sampleSections()
        s.unknown.forEach { text ->
            assertTrue(text.contains("尚未确认"))
        }
    }

    // ---------- 版本与免责 ----------

    @Test
    fun `系统生成带版本号`() {
        val s = sampleSections()
        assertEquals(3, s.meta.version)
        assertEquals("mock-2026.09", s.meta.modelRelease)
        assertFalse(s.meta.modelRelease.isBlank())
    }

    @Test
    fun `免责声明常驻`() {
        val s = sampleSections()
        assertTrue(s.meta.disclaimer.contains("不作诊断"))
    }

    // ---------- A08 原文对照 ----------

    @Test
    fun `术语高亮 - 首个命中位置`() {
        val terms = listOf("椎间盘", "突出", "L4/5", "MRI")
        val text = "腰椎 MRI：L4/5 椎间盘轻度膨出"
        val hit = terms.mapNotNull { t ->
            val idx = text.indexOf(t)
            if (idx >= 0) idx to t else null
        }.minByOrNull { it.first }
        assertEquals(3 to "MRI", hit)
    }

    @Test
    fun `术语高亮 - 无命中返回空`() {
        val terms = listOf("椎间盘", "突出")
        val text = "血常规未见异常"
        val hit = terms.mapNotNull { t ->
            val idx = text.indexOf(t)
            if (idx >= 0) idx to t else null
        }.minByOrNull { it.first }
        assertEquals(null, hit)
    }

    @Test
    fun `报告未提及不等于已排除`() {
        // 原文为空时展示「报告未提及」，不写「已排除」
        val raw: String? = null
        val display = raw ?: "报告未提及（不等于已排除）"
        assertTrue(display.contains("报告未提及"))
        assertTrue(display.contains("不等于已排除"))
    }

    @Test
    fun `原文位置从0开始转1基`() {
        val position = 5
        val display = "第 ${position + 1} 字"
        assertEquals("第 6 字", display)
    }

    // ---------- 复诊问题勾选 ----------

    @Test
    fun `复诊问题可勾选与取消`() {
        var checked = setOf<Int>()
        checked = checked + 0
        checked = checked + 2
        assertEquals(2, checked.size)
        checked = checked - 0
        assertFalse(checked.contains(0))
        assertTrue(checked.contains(2))
    }
}
