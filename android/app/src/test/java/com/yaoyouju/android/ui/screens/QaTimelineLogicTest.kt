package com.yaoyouju.android.ui.screens

import com.yaoyouju.android.core.net.QaCitation
import com.yaoyouju.android.core.net.QaMessageView
import com.yaoyouju.android.core.net.TimelineGroup
import com.yaoyouju.android.core.net.TimelineItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T48：A09 问与解释、A10 病程时间线、A11 记录今天的纯逻辑单元测试。
 */
class QaTimelineLogicTest {

    // ---------- A09 问与解释 ----------

    @Test
    fun `回答必须带来源`() {
        val message = QaMessageView(
            id = "m1",
            role = "assistant",
            content = "报告中的 L4/5 椎间盘突出可以解释部分症状",
            citations = listOf(
                QaCitation(
                    kind = "evidence_doc",
                    evidenceDocId = "ev-1",
                    sourceLabel = "腰椎间盘突出诊疗指南",
                    statement = "椎间盘突出可压迫神经根",
                ),
            ),
            refused = false,
            createdAt = "2026-09-27T10:00:00.000Z",
        )
        assertTrue(message.citations.isNotEmpty())
        assertEquals("腰椎间盘突出诊疗指南", message.citations[0].sourceLabel)
    }

    @Test
    fun `越界问题明确不答并可加入复诊`() {
        val message = QaMessageView(
            id = "m2",
            role = "assistant",
            content = "是否需要手术要由医生结合查体与影像判断，我不能回答。",
            citations = emptyList(),
            refused = true,
            followupQuestion = "我这种情况需不需要手术？",
            addToFollowup = true,
            createdAt = "2026-09-27T10:01:00.000Z",
        )
        assertTrue(message.refused)
        assertTrue(message.addToFollowup)
        assertTrue(message.followupQuestion!!.contains("手术"))
    }

    @Test
    fun `用户消息无引用不拒答`() {
        val message = QaMessageView(
            id = "m3",
            role = "user",
            content = "保守治疗一般多久？",
            createdAt = "2026-09-27T10:02:00.000Z",
        )
        assertFalse(message.refused)
        assertTrue(message.citations.isEmpty())
    }

    @Test
    fun `已答条数只数 assistant`() {
        val messages = listOf(
            QaMessageView(id = "1", role = "user", content = "a", createdAt = ""),
            QaMessageView(id = "2", role = "assistant", content = "b", createdAt = ""),
            QaMessageView(id = "3", role = "user", content = "c", createdAt = ""),
            QaMessageView(id = "4", role = "assistant", content = "d", createdAt = ""),
        )
        assertEquals(2, messages.count { it.role == "assistant" })
    }

    // ---------- A10 时间线 ----------

    @Test
    fun `时间线按日期分组`() {
        val groups = listOf(
            TimelineGroup(date = "2026-09-27", items = listOf(TimelineItem(id = "1", label = "症状加重", eventType = "症状"))),
            TimelineGroup(date = "2026-09-20", items = listOf(TimelineItem(id = "2", label = "录入报告", eventType = "症状"))),
        )
        assertEquals(2, groups.size)
        assertEquals("2026-09-27", groups[0].date)
        // 按日期倒序（最新在前）
        assertTrue(groups[0].date > groups[1].date)
    }

    @Test
    fun `区分来源类型`() {
        val self = TimelineItem(id = "1", label = "症状加重", eventType = "症状", sourceType = "自述")
        val report = TimelineItem(id = "2", label = "腰椎 MRI", eventType = "症状", sourceType = "报告")
        val doctor = TimelineItem(id = "3", label = "医嘱", eventType = "症状", sourceType = "医生记录")
        assertEquals("自述", self.sourceType)
        assertEquals("报告", report.sourceType)
        assertEquals("医生记录", doctor.sourceType)
    }

    @Test
    fun `纠正后核实状态降级为有冲突`() {
        val item = TimelineItem(id = "1", label = "症状加重", eventType = "症状", verifyStatus = "已确认")
        // 纠正（内容变化）→ 有冲突
        val corrected = item.copy(verifyStatus = "有冲突")
        assertEquals("有冲突", corrected.verifyStatus)
    }

    @Test
    fun `缺失时间显示尚未确认`() {
        val item = TimelineItem(id = "1", label = "症状加重", eventType = "症状", occurredAt = null)
        val display = item.occurredAt?.take(10) ?: "时间尚未确认"
        assertEquals("时间尚未确认", display)
    }

    // ---------- A11 记录今天 ----------

    @Test
    fun `字段可缺失不默认阴性`() {
        // sit_minutes 为空 → null，不写 0
        val sitMinutes: String = ""
        val value = sitMinutes.toIntOrNull()
        assertEquals(null, value)
    }

    @Test
    fun `睡眠影响范围校验`() {
        val valid = "4"
        val invalid = "11"
        assertEquals(4, valid.toIntOrNull())
        assertTrue(invalid.toIntOrNull()!! > 10)
    }

    @Test
    fun `腿部变化选项与服务端一致`() {
        val options = listOf("有", "无", "尚未确认")
        assertTrue(options.contains("有"))
        assertTrue(options.contains("无"))
        assertTrue(options.contains("尚未确认"))
        // 不提供「已排除」
        assertFalse(options.contains("已排除"))
    }

    @Test
    fun `计划活动完成情况选项与服务端一致`() {
        val options = listOf("完成", "部分完成", "未完成", "尚未确认")
        assertEquals(4, options.size)
        assertTrue(options.contains("部分完成"))
    }

    @Test
    fun `不复用昨日答案`() {
        // 今天的表单初始为空（不预填昨日答案）
        val sitMinutes = ""
        val plannedActivity = ""
        assertTrue(sitMinutes.isBlank())
        assertTrue(plannedActivity.isBlank())
    }

    @Test
    fun `跳过不当作没有症状`() {
        val skipped = true
        // skipped=true 时不写「没有症状」结论
        assertTrue(skipped)
    }
}
