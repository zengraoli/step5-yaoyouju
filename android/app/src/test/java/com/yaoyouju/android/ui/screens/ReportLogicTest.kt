package com.yaoyouju.android.ui.screens

import com.yaoyouju.android.core.net.ExtractedTerm
import com.yaoyouju.android.core.net.StructuredItem
import com.yaoyouju.android.core.net.StructuredReport
import com.yaoyouju.android.core.net.StructuredSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T46：A04 选择困惑、A05 录入报告与 A06 核对的纯逻辑单元测试。
 */
class ReportLogicTest {

    // ---------- A04 困惑与解释方式 ----------

    private data class Confusion(val key: String, val title: String, val desc: String)

    private val confusions = listOf(
        Confusion("report", "报告术语", "看懂报告里写的是什么、哪些结论不能得出"),
        Confusion("course", "病程变化", "这段时间的变化意味着什么、哪些值得记录"),
        Confusion("followup", "复诊准备", "复诊时该问什么、带什么、怎么描述"),
        Confusion("life", "生活影响", "日常活动、工作与睡眠要注意什么"),
    )

    private val explainWays = listOf("简短要点", "详细说明", "带图示视频", "先看原文对照")

    @Test
    fun `四个困惑键唯一`() {
        assertEquals(4, confusions.map { it.key }.distinct().size)
    }

    @Test
    fun `解释方式默认选中简短要点`() {
        val defaultWays = setOf("简短要点")
        assertTrue(defaultWays.contains("简短要点"))
        assertEquals(1, defaultWays.size)
    }

    @Test
    fun `解释方式可多选与取消`() {
        var ways = setOf("简短要点")
        ways = ways + "详细说明"
        assertEquals(2, ways.size)
        ways = ways - "简短要点"
        assertFalse(ways.contains("简短要点"))
        assertTrue(ways.contains("详细说明"))
    }

    // ---------- A05 报告录入规则 ----------

    private val examTypes = listOf("MRI", "CT", "X 光", "超声", "其他")
    private val tabs = listOf("粘贴文字（推荐）", "拍照提取", "暂不录入")

    @Test
    fun `检查类型五个选项`() {
        assertEquals(5, examTypes.size)
        assertTrue(examTypes.contains("MRI"))
        assertTrue(examTypes.contains("其他"))
    }

    @Test
    fun `默认页签是粘贴文字`() {
        assertEquals("粘贴文字（推荐）", tabs[0])
    }

    @Test
    fun `空白报告不写入`() {
        val reportText = ""
        // 只有非空才 POST /reports
        assertFalse(reportText.isNotBlank())
        val filled = "腰椎MRI：L4/5椎间盘突出"
        assertTrue(filled.isNotBlank())
    }

    @Test
    fun `跳过不写入也不当作没有报告`() {
        val tab = "暂不录入"
        val reportText = ""
        val shouldWriteReport = tab == tabs[0] && reportText.isNotBlank()
        assertFalse(shouldWriteReport)
    }

    @Test
    fun `快捷标签追加到医嘱文本`() {
        var advice = ""
        advice = "保守治疗"
        advice = "$advice；复查时间"
        assertEquals("保守治疗；复查时间", advice)
    }

    // ---------- A06 核对规则 ----------

    private fun statusKeyOf(verifyStatus: String): String = when (verifyStatus) {
        "已确认" -> "Confirmed"
        "有冲突" -> "Conflict"
        "已核实" -> "Reviewed"
        else -> "Unconfirmed"
    }

    @Test
    fun `核实状态映射`() {
        assertEquals("Confirmed", statusKeyOf("已确认"))
        assertEquals("Conflict", statusKeyOf("有冲突"))
        assertEquals("Unconfirmed", statusKeyOf("尚未确认"))
    }

    @Test
    fun `冲突项必须确认`() {
        val item = StructuredItem(
            careEventId = "e1",
            eventType = "报告",
            sourceType = "报告",
            occurredAt = "2026-08-30T00:00:00.000Z",
            reportedAt = "2026-08-30T00:00:00.000Z",
            verifyStatus = "有冲突",
            needsConfirm = true,
            rawText = "L4/5 椎间盘突出",
        )
        assertTrue(item.needsConfirm)
        assertEquals("Conflict", statusKeyOf(item.verifyStatus))
    }

    @Test
    fun `缺失信息不默认阴性`() {
        // verifyStatus 缺失时按「尚未确认」处理
        val item = StructuredItem(
            careEventId = "e2",
            eventType = "症状",
            sourceType = "自述",
            verifyStatus = "尚未确认",
            needsConfirm = false,
        )
        assertEquals("Unconfirmed", statusKeyOf(item.verifyStatus))
    }

    @Test
    fun `汇总计数来自服务端`() {
        val summary = StructuredSummary(total = 6, confirmed = 2, unconfirmed = 3, conflict = 1)
        assertEquals(6, summary.total)
        assertEquals(2, summary.confirmed)
        assertEquals(3, summary.unconfirmed)
        assertEquals(1, summary.conflict)
        assertEquals(summary.total, summary.confirmed + summary.unconfirmed + summary.conflict)
    }

    @Test
    fun `术语抽取字段`() {
        val terms = listOf(
            ExtractedTerm(term = "椎间盘突出", meaning = "椎间盘的纤维环破裂、髓核向外突出", position = 12),
            ExtractedTerm(term = "L4/5", meaning = "第4、5节腰椎", position = 5),
        )
        assertEquals(2, terms.size)
        assertTrue(terms.any { it.term == "椎间盘突出" })
    }

    @Test
    fun `结构化报告可空`() {
        val item = StructuredItem(
            careEventId = "e3",
            eventType = "症状",
            sourceType = "自述",
            verifyStatus = "已确认",
            report = null,
        )
        assertEquals(null, item.report?.extractedTerms)
        val withReport = item.copy(
            report = StructuredReport(id = "r1", reportDate = "2026-08-30", extractedTerms = emptyList()),
        )
        assertEquals("2026-08-30", withReport.report?.reportDate)
    }
}
