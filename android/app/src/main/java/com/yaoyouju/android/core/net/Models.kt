package com.yaoyouju.android.core.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * 服务端统一响应格式：{"code": 0, "data": ..., "message": "ok"}
 * code 非 0 时为业务错误，message 为中文。
 */
@Serializable
data class ApiResponse<T>(
    val code: Int,
    val data: T? = null,
    val message: String = "ok",
)

/** 业务错误：携带服务端返回的 code、中文 message 与结构化 data（如就医提示） */
class ApiException(
    val code: Int,
    override val message: String,
    val data: String? = null,
) : Exception(message)

/** 登录结果（POST /auth/login） */
@Serializable
data class LoginResult(
    val token: String,
    val user: LoginUser,
    val consents: List<ConsentItem> = emptyList(),
)

@Serializable
data class LoginUser(
    val id: String,
    @SerialName("phone_masked") val phoneMasked: String,
)

/** 单条同意记录：可查、可撤回 */
@Serializable
data class ConsentItem(
    val id: String,
    val scope: String,
    val granted: Boolean,
    @SerialName("granted_at") val grantedAt: String? = null,
    @SerialName("revoked_at") val revokedAt: String? = null,
)

/** 只返回 { ok: true } 的接口（退出登录 / 取消删除申请） */
@Serializable
data class OkResult(val ok: Boolean = true)

@Serializable
data class SmsCodeResult(
    val sent: Boolean = true,
    val masked: String = "",
)

/** 就医提示内容（GET /safety/emergency-notice 与 409 响应 data） */
@Serializable
data class EmergencyNotice(
    val title: String = "",
    val headline: String = "",
    val body: String = "",
    @SerialName("offline_note") val offlineNote: String = "",
    val actions: List<EmergencyAction> = emptyList(),
    @SerialName("bring_list") val bringList: List<String> = emptyList(),
    @SerialName("summary_action") val summaryAction: SummaryAction? = null,
    @SerialName("footer_note") val footerNote: String = "",
    val matched: List<MatchedRule> = emptyList(),
)

@Serializable
data class EmergencyAction(
    val type: String,
    val label: String,
)

@Serializable
data class SummaryAction(val label: String = "")

/** 命中的红旗规则（就医提示展示用） */
@Serializable
data class MatchedRule(
    @SerialName("rule_code") val ruleCode: String = "",
    val label: String = "",
    val severity: String = "",
    val action: String = "",
    val advice: String = "",
    val excerpt: String = "",
)

/** 就医提示（写入 / 分析 / 问答接口命中红旗时在 data 里返回） */
@Serializable
data class SafetyNotice(
    val title: String = "",
    val headline: String = "",
    val body: String = "",
    val matched: List<MatchedRule> = emptyList(),
    @SerialName("rule_set_version") val ruleSetVersion: String = "",
)

/** 就医提示（公开接口，无需登录；R03：不被登录阻断） */
interface SafetyApi {
    @retrofit2.http.GET("safety/emergency-notice")
    suspend fun emergencyNotice(): retrofit2.Response<ApiResponse<EmergencyNotice>>
}

/** 功能开关（公开读取） */
interface SwitchesApi {
    @retrofit2.http.GET("switches")
    suspend fun switches(): retrofit2.Response<ApiResponse<List<SwitchState>>>
}

@Serializable
data class SwitchState(
    val key: String,
    val enabled: Boolean,
    val reason: String? = null,
)

/** 我的数据导出（JSON 全文） */
@Serializable
data class AccountExport(
    @SerialName("exported_at") val exportedAt: String = "",
    val user: ExportUser = ExportUser(),
    val consents: JsonObject = JsonObject(emptyMap()),
    val episodes: JsonObject = JsonObject(emptyMap()),
    val analyses: JsonObject = JsonObject(emptyMap()),
    @SerialName("followup_summaries") val followupSummaries: JsonObject = JsonObject(emptyMap()),
    @SerialName("followup_questions") val followupQuestions: JsonObject = JsonObject(emptyMap()),
    @SerialName("qa_sessions") val qaSessions: JsonObject = JsonObject(emptyMap()),
    val feedback: JsonObject = JsonObject(emptyMap()),
    @SerialName("safety_events") val safetyEvents: JsonObject = JsonObject(emptyMap()),
    val note: String = "",
)

@Serializable
data class ExportUser(
    val id: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("phone_masked") val phoneMasked: String = "",
)

/* ---------------- 请求体（全部用 @Serializable 数据类，避免 Map 转换失败） ---------------- */

@Serializable
data class SmsCodeRequest(val phone: String)

@Serializable
data class LoginRequest(val phone: String, val code: String)

@Serializable
data class ConsentRequest(val scope: String)

@Serializable
data class DeleteAccountRequest(val phone: String, val code: String)

@Serializable
data class CreateEpisodeRequest(
    val title: String,
    @SerialName("onset_date") val onsetDate: String? = null,
    @SerialName("onset_certainty") val onsetCertainty: String? = null,
)

@Serializable
data class UpdateEpisodeRequest(
    val title: String? = null,
    @SerialName("onset_date") val onsetDate: String? = null,
    @SerialName("onset_certainty") val onsetCertainty: String? = null,
    val status: String? = null,
)

@Serializable
data class CreateCareEventRequest(
    @SerialName("event_type") val eventType: String,
    @SerialName("occurred_at") val occurredAt: String,
    @SerialName("source_type") val sourceType: String,
    @SerialName("raw_text") val rawText: String? = null,
    @SerialName("verify_status") val verifyStatus: String = "尚未确认",
)

@Serializable
data class UpdateCareEventRequest(
    @SerialName("raw_text") val rawText: String? = null,
    @SerialName("occurred_at") val occurredAt: String? = null,
    @SerialName("source_type") val sourceType: String? = null,
    @SerialName("verify_status") val verifyStatus: String? = null,
)

@Serializable
data class LogTodayRequest(
    @SerialName("sit_minutes") val sitMinutes: Int? = null,
    @SerialName("planned_activity_done") val plannedActivityDone: String? = null,
    @SerialName("sleep_impact") val sleepImpact: Int? = null,
    @SerialName("top_worry") val topWorry: String? = null,
    @SerialName("leg_change") val legChange: String? = null,
    val skipped: Boolean? = null,
)

@Serializable
data class CreateReportRequest(
    @SerialName("episode_id") val episodeId: String,
    @SerialName("care_event_id") val careEventId: String? = null,
    @SerialName("report_date") val reportDate: String? = null,
    @SerialName("raw_text") val rawText: String,
    @SerialName("source_type") val sourceType: String = "报告原文",
    @SerialName("verify_status") val verifyStatus: String = "尚未确认",
)

@Serializable
data class CreateAnalysisRequest(
    @SerialName("episode_id") val episodeId: String,
    @SerialName("symptom_change") val symptomChange: String? = null,
    @SerialName("report_text") val reportText: String? = null,
    val question: String? = null,
)

@Serializable
data class CreateQaSessionRequest(
    @SerialName("episode_id") val episodeId: String? = null,
)

@Serializable
data class AskRequest(val content: String)

@Serializable
data class AddFollowupQuestionRequest(val question: String)

@Serializable
data class CorrectFollowupRequest(val sections: List<FollowupSectionInput> = emptyList())

@Serializable
data class FollowupSectionInput(
    val key: String,
    val items: List<FollowupItemInput> = emptyList(),
)

@Serializable
data class FollowupItemInput(
    val text: String,
    val source: String = "自述",
    @SerialName("verify_status") val verifyStatus: String = "尚未确认",
)

@Serializable
data class ExportFollowupRequest(val format: String)

@Serializable
data class HelpFeedbackRequest(
    @SerialName("analysis_id") val analysisId: String,
    @SerialName("help_type") val helpType: String,
    @SerialName("unsolved_question") val unsolvedQuestion: String? = null,
)

@Serializable
data class ErrorReportRequest(
    @SerialName("analysis_id") val analysisId: String? = null,
    @SerialName("content_item_id") val contentItemId: String? = null,
    val category: String,
    val description: String,
    val severity: String? = null,
)

/**
 * 命中红旗信号（保存成功但需要立即就医提示时抛出，UI 捕获后跳转就医提示页）。
 * 产品红线：命中红旗立即展示就医提示，不被任何流程阻断。
 */
class SafetySignalException(
    val labels: String,
    val stop: Boolean,
) : Exception("检测到需要及时就医的信号：$labels")
