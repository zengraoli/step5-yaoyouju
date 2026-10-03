package com.yaoyouju.android.core.net

import com.yaoyouju.android.ui.screens.safetyNoticeOf
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import kotlinx.coroutines.runBlocking
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

/**
 * 第六轮验收反馈第 9 / 24 / 28 条：HTTP 4xx 的业务错误必须保留服务端的错误码与中文提示
 * （Retrofit 把错误响应体放在 errorBody()、body() 为 null，只读 body 会退化成
 * 「服务暂时不可用（409）」）；真实服务端 JSON（导出数据 / 内容详情）要能解析。
 */
class ApiErrorHandlingTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    /** 用服务端真实返回体构造 HTTP 错误响应（Retrofit 把错误体放在 errorBody） */
    private fun <T> errorResponse(raw: String, httpCode: Int): retrofit2.Response<ApiResponse<T>> {
        val body = okhttp3.ResponseBody.create(
            "application/json".toMediaType(),
            raw.toByteArray(),
        )
        return retrofit2.Response.error(httpCode, body)
    }

    @Test
    fun `解析 HTTP 409 的 errorBody（业务错误不走兜底文案）`() {
        // 服务端真实返回体（安全规则命中：40911 + 就医提示）
        val raw = """{"code":40911,"data":{"title":"需要及时寻求专业帮助","headline":"建议尽快就医","body":"你提交的内容包含需要尽快就医的信号：大小便控制变化。","matched":[{"rule_code":"RF-03","label":"大小便控制变化","severity":"high","action":"停止个性化分析","advice":"大小便控制出现变化需要尽快由医生评估，请立即就医。","excerpt":"大小便控制变化"}]},"message":"大小便控制出现变化需要尽快由医生评估，请立即就医。"}"""
        // 直接调用产品代码 handleResponse：错误码与中文提示必须保留
        val ex = runBlocking { runCatching { handleResponse(errorResponse<LoginUser>(raw, 409)) }.exceptionOrNull() }
        assertTrue(ex is ApiException)
        ex as ApiException
        assertEquals(40911, ex.code)
        assertTrue(ex.message.contains("立即就医"))
        // 就医提示 data 能被产品代码解析出来（界面据此跳就医提示页）
        val notice = safetyNoticeOf(ex)
        requireNotNull(notice)
        assertEquals("大小便控制变化", notice.first)
        assertEquals(true, notice.second)
    }

    @Test
    fun `解析 HTTP 409 的 errorBody（冷静期未到）`() {
        val raw = """{"code":40900,"data":null,"message":"还在冷静期内（2026-10-04 10:00 之后才能确认删除），可以取消删除"}"""
        val ex = runBlocking { runCatching { handleResponse(errorResponse<LoginUser>(raw, 409)) }.exceptionOrNull() }
        assertTrue(ex is ApiException)
        ex as ApiException
        assertEquals(40900, ex.code)
        assertTrue(ex.message.contains("冷静期"))
    }

    @Test
    fun `解析 HTTP 400 的 errorBody（能坐时长超限）`() {
        val raw = """{"code":40000,"data":null,"message":"能坐时长不能大于 1440"}"""
        val ex = runBlocking { runCatching { handleResponse(errorResponse<LoginUser>(raw, 400)) }.exceptionOrNull() }
        assertTrue(ex is ApiException)
        ex as ApiException
        assertEquals(40000, ex.code)
        assertEquals("能坐时长不能大于 1440", ex.message)
    }

    @Test
    fun `解析真实导出数据（consents 等字段是数组）`() {
        val raw = """{"code":0,"data":{"exported_at":"2026-10-03T02:00:00.000Z","user":{"id":"u1","created_at":"2026-09-01T00:00:00.000Z","phone_masked":"138****1234"},"consents":[{"id":"c1","scope":"健康信息处理","granted":true,"granted_at":"2026-09-01T10:12:00.000Z","revoked_at":null}],"episodes":[],"analyses":[],"followup_summaries":[],"followup_questions":[],"qa_sessions":[],"feedback":[],"safety_events":[],"note":"n"},"message":"ok"}"""
        val resp = json.decodeFromString<ApiResponse<AccountExport>>(raw)
        val data = resp.data!!
        assertEquals(1, data.consents.size)
        assertTrue(data.consents[0].toString().contains("健康信息处理"))
        assertEquals("138****1234", data.user.phoneMasked)
    }

    @Test
    fun `解析内容详情（reviewer_role 缺省为空，不抛错）`() {
        val raw = """{"code":0,"data":{"id":"c1","type":"视频","title":"看懂腰椎 MRI 报告","applicable_scope":"a","not_applicable":"b","current_status":"已发布","offline":false,"current_version":{"version":1,"script":"s","subtitle_text":"t","asset_key":null,"published_at":"2026-07-01T00:00:00.000Z"},"versions":[],"review_records":[{"id":"r1","decision":"通过","review_scope":"医学准确性","comment":"ok","reviewer_name":"clinician01","reviewed_at":"2026-07-01T00:00:00.000Z"}],"disclaimer":"d"},"message":"ok"}"""
        val resp = json.decodeFromString<ApiResponse<ContentDetail>>(raw)
        val detail = resp.data!!
        assertEquals(1, detail.reviewRecords.size)
        assertEquals("", detail.reviewRecords[0].reviewerRole)
        assertEquals("clinician01", detail.reviewRecords[0].reviewerName)
        assertEquals("通过", detail.reviewRecords[0].decision)
    }
}
