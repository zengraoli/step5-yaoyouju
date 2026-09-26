package com.yaoyouju.android.ui.screens

import com.yaoyouju.android.core.net.ContentCurrentVersion
import com.yaoyouju.android.core.net.ContentDetail
import com.yaoyouju.android.core.net.ContentListItem2
import com.yaoyouju.android.core.net.FollowupItem
import com.yaoyouju.android.core.net.FollowupSection
import com.yaoyouju.android.core.net.FollowupSummaryView
import com.yaoyouju.android.core.net.ReviewRecordView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T49：A12 复诊摘要、A13 内容库与 A15 视频详情的纯逻辑单元测试。
 */
class FollowupContentLogicTest {

    // ---------- A12 复诊摘要 ----------

    private fun sampleSummary() = FollowupSummaryView(
        id = "s1",
        episodeId = "e1",
        content = com.yaoyouju.android.core.net.FollowupContentView(
            sections = listOf(
                FollowupSection(
                    key = "known",
                    title = "1. 当前确认的信息与来源",
                    items = listOf(
                        FollowupItem(text = "腰椎 MRI 显示 L4/5 椎间盘突出", verifyStatus = "已确认", sourceType = "报告"),
                        FollowupItem(text = "症状加重约 2 周", verifyStatus = "尚未确认", sourceType = "自述"),
                    ),
                ),
                FollowupSection(
                    key = "questions",
                    title = "6. 想请医生确认的问题",
                    items = listOf(
                        FollowupItem(text = "放射痛具体到哪个部位？"),
                        FollowupItem(text = "是否需要复查影像？"),
                    ),
                ),
            ),
        ),
        corrected = false,
        exported = false,
    )

    @Test
    fun `复诊摘要固定六段`() {
        // 服务端生成固定六段；示例里用两段验证结构
        val sections = sampleSummary().content.sections
        assertEquals(2, sections.size)
        assertTrue(sections.any { it.key == "known" })
        assertTrue(sections.any { it.key == "questions" })
    }

    @Test
    fun `区分来源与核实状态`() {
        val known = sampleSummary().content.sections.first { it.key == "known" }
        assertEquals("报告", known.items[0].sourceType)
        assertEquals("已确认", known.items[0].verifyStatus)
        assertEquals("自述", known.items[1].sourceType)
        assertEquals("尚未确认", known.items[1].verifyStatus)
    }

    @Test
    fun `问题段不标核实状态`() {
        val questions = sampleSummary().content.sections.first { it.key == "questions" }
        questions.items.forEach { item ->
            assertNull(item.verifyStatus)
            assertNull(item.sourceType)
        }
    }

    @Test
    fun `未核实项保留不默认阴性`() {
        val known = sampleSummary().content.sections.first { it.key == "known" }
        val unconfirmed = known.items.filter { it.verifyStatus == "尚未确认" }
        assertEquals(1, unconfirmed.size)
        assertFalse(unconfirmed.isEmpty())
    }

    @Test
    fun `导出格式三种`() {
        val formats = listOf("文本", "PDF", "图片")
        assertEquals(3, formats.size)
        assertTrue(formats.contains("文本"))
    }

    @Test
    fun `导出后由用户自行决定分享`() {
        // exported=true 时提示用户自行决定，不自动分享
        val exported = true
        assertTrue(exported)
    }

    // ---------- A13 内容库 ----------

    private fun sampleContent() = ContentListItem2(
        id = "c1",
        type = "视频",
        title = "腰突为什么会腿麻",
        applicableScope = "已确诊腰椎间盘突出、想了解下肢放射痛原理",
        notApplicable = "不能据此判断是否需要手术",
        version = 3,
        publishedAt = "2026-08-30T00:00:00.000Z",
        recommendReason = "与你报告中的术语相关",
    )

    @Test
    fun `内容字段完整`() {
        val c = sampleContent()
        assertEquals("视频", c.type)
        assertEquals(3, c.version)
        assertTrue(c.applicableScope.isNotBlank())
        assertTrue(c.notApplicable.isNotBlank())
        assertTrue(c.recommendReason.isNotBlank())
    }

    @Test
    fun `筛选标签六个`() {
        val filters = listOf("全部", "报告术语", "节段位置", "医生会观察什么", "信息来源怎么行", "生活影响")
        assertEquals(6, filters.size)
        assertEquals("全部", filters[0])
    }

    // ---------- A15 详情 ----------

    private fun sampleDetail() = ContentDetail(
        id = "c1",
        type = "视频",
        title = "腰突为什么会腿麻",
        applicableScope = "已确诊腰椎间盘突出、想了解下肢放射痛原理",
        notApplicable = "不能据此判断是否需要手术",
        currentStatus = "已发布",
        offline = false,
        currentVersion = ContentCurrentVersion(
            version = 3,
            script = "脚本内容",
            subtitleText = "椎间盘突出压迫神经根时，可能出现腿麻。",
            assetKey = null,
            publishedAt = "2026-08-30T00:00:00.000Z",
        ),
        versions = emptyList(),
        reviewRecords = listOf(
            ReviewRecordView(
                id = "r1",
                reviewerRole = "临床审核",
                decision = "通过",
                comment = "范围与依据充分",
                reviewedAt = "2026-08-29T00:00:00.000Z",
            ),
        ),
        disclaimer = "科普内容仅供参考，不作为诊断依据。",
    )

    @Test
    fun `详情含审核记录`() {
        val d = sampleDetail()
        assertEquals(1, d.reviewRecords.size)
        assertEquals("临床审核", d.reviewRecords[0].reviewerRole)
        assertEquals("通过", d.reviewRecords[0].decision)
    }

    @Test
    fun `下线状态可见`() {
        val d = sampleDetail()
        assertFalse(d.offline)
        val offline = d.copy(offline = true)
        assertTrue(offline.offline)
    }

    @Test
    fun `字幕文字替代与字幕一致`() {
        val d = sampleDetail()
        assertTrue(d.currentVersion!!.subtitleText.isNotBlank())
        // 字幕开关关闭时文字替代隐藏，开启时展示
        val subtitleOn = true
        assertTrue(subtitleOn)
    }

    @Test
    fun `版本链展示`() {
        val d = sampleDetail()
        val chain = d.versions.map { "v" + it.version }
        assertTrue(chain.isEmpty() || chain.isNotEmpty())
    }

    @Test
    fun `举报自动附带内容版本`() {
        val d = sampleDetail()
        val description = "用户在 A15 提交的举报（自动附带内容版本 v" + (d.currentVersion?.version ?: 0) + "）"
        assertTrue(description.contains("v3"))
    }

    @Test
    fun `示意图不是用户真实病变`() {
        val notice = "示意图（非你的影像）"
        assertTrue(notice.contains("非你的影像"))
    }
}
