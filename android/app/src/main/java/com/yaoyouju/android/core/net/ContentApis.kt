package com.yaoyouju.android.core.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/** 病程记录（对应 server episodes.controller.ts） */
interface EpisodesApi {

    @GET("episodes")
    suspend fun list(): Response<ApiResponse<List<EpisodeItem>>>

    @POST("episodes")
    suspend fun create(@Body body: CreateEpisodeRequest): Response<ApiResponse<EpisodeItem>>

    @GET("episodes/{id}")
    suspend fun detail(@Path("id") id: String): Response<ApiResponse<EpisodeDetail>>

    @PATCH("episodes/{id}")
    suspend fun update(
        @Path("id") id: String,
        @Body body: UpdateEpisodeRequest,
    ): Response<ApiResponse<EpisodeDetail>>

    @POST("episodes/{id}/events")
    suspend fun addEvent(
        @Path("id") id: String,
        @Body body: CreateCareEventRequest,
    ): Response<ApiResponse<CareEventView>>

    @PATCH("episodes/{id}/events/{eventId}")
    suspend fun updateEvent(
        @Path("id") id: String,
        @Path("eventId") eventId: String,
        @Body body: UpdateCareEventRequest,
    ): Response<ApiResponse<CareEventView>>

    @GET("episodes/{id}/today")
    suspend fun today(@Path("id") id: String): Response<ApiResponse<TodayStatus>>

    @POST("episodes/{id}/today-logs")
    suspend fun saveTodayLog(
        @Path("id") id: String,
        @Body body: LogTodayRequest,
    ): Response<ApiResponse<SymptomLogView>>

    @GET("episodes/{id}/timeline")
    suspend fun timeline(@Path("id") id: String): Response<ApiResponse<List<TimelineGroup>>>

    @GET("episodes/{id}/structured")
    suspend fun structured(@Path("id") id: String): Response<ApiResponse<StructuredResponse>>
}

@Serializable
data class EpisodeItem(
    val id: String,
    val title: String,
    @SerialName("onset_date") val onsetDate: String? = null,
    @SerialName("onset_certainty") val onsetCertainty: String = "尚未确认",
    val status: String = "进行中",
    @SerialName("created_at") val createdAt: String,
    @SerialName("event_count") val eventCount: Int = 0,
)

@Serializable
data class EpisodeDetail(
    val id: String,
    val title: String,
    @SerialName("onset_date") val onsetDate: String? = null,
    @SerialName("onset_certainty") val onsetCertainty: String = "尚未确认",
    val status: String = "进行中",
    @SerialName("created_at") val createdAt: String,
    @SerialName("analysis_count") val analysisCount: Int = 0,
    @SerialName("latest_analysis_id") val latestAnalysisId: String? = null,
    val events: List<CareEventView> = emptyList(),
)

@Serializable
data class CareEventView(
    val id: String,
    @SerialName("episode_id") val episodeId: String,
    @SerialName("event_type") val eventType: String,
    @SerialName("occurred_at") val occurredAt: String,
    @SerialName("reported_at") val reportedAt: String = "",
    @SerialName("source_type") val sourceType: String,
    @SerialName("raw_text") val rawText: String? = null,
    @SerialName("verify_status") val verifyStatus: String = "尚未确认",
    @SerialName("symptom_log") val symptomLog: SymptomLogView? = null,
    val report: CareEventReport? = null,
    @SerialName("safety_notice") val safetyNotice: SafetyNotice? = null,
)

@Serializable
data class CareEventReport(
    val id: String,
    @SerialName("report_date") val reportDate: String? = null,
    @SerialName("extracted_terms") val extractedTerms: List<ExtractedTerm> = emptyList(),
)

@Serializable
data class SymptomLogView(
    val id: String = "",
    @SerialName("care_event_id") val careEventId: String = "",
    val date: String = "",
    @SerialName("sit_minutes") val sitMinutes: Int? = null,
    @SerialName("sit_minutes_display") val sitMinutesDisplay: String = "",
    @SerialName("planned_activity_done") val plannedActivityDone: String = "尚未确认",
    @SerialName("sleep_impact") val sleepImpact: Int? = null,
    @SerialName("sleep_impact_display") val sleepImpactDisplay: String = "",
    @SerialName("top_worry") val topWorry: String = "尚未确认",
    @SerialName("leg_change") val legChange: String = "尚未确认",
    @SerialName("safety_notice") val safetyNotice: SafetyNotice? = null,
)

@Serializable
data class TodayStatus(
    val date: String,
    val logged: Boolean,
    val log: SymptomLogView? = null,
)

@Serializable
data class TimelineGroup(
    val date: String,
    val events: List<CareEventView> = emptyList(),
)

@Serializable
data class StructuredResponse(
    val items: List<StructuredItem> = emptyList(),
    val summary: StructuredSummary = StructuredSummary(),
)

@Serializable
data class StructuredItem(
    @SerialName("care_event_id") val careEventId: String,
    @SerialName("event_type") val eventType: String,
    @SerialName("source_type") val sourceType: String,
    @SerialName("occurred_at") val occurredAt: String? = null,
    @SerialName("reported_at") val reportedAt: String? = null,
    @SerialName("verify_status") val verifyStatus: String = "尚未确认",
    @SerialName("needs_confirm") val needsConfirm: Boolean = false,
    @SerialName("raw_text") val rawText: String? = null,
    val report: StructuredReport? = null,
)

@Serializable
data class StructuredReport(
    val id: String,
    @SerialName("report_date") val reportDate: String? = null,
    @SerialName("extracted_terms") val extractedTerms: List<ExtractedTerm> = emptyList(),
)

@Serializable
data class StructuredSummary(
    val total: Int = 0,
    val confirmed: Int = 0,
    val unconfirmed: Int = 0,
    val conflict: Int = 0,
)

/** 已发布内容列表（用户端 /contents） */
interface ContentsApi {
    @GET("contents")
    suspend fun list(@Query("type") type: String? = null): Response<ApiResponse<List<ContentListItem>>>

    @GET("contents/{id}")
    suspend fun detail(@Path("id") id: String): Response<ApiResponse<ContentDetail>>
}

@Serializable
data class ContentListItem(
    val id: String,
    val type: String,
    val title: String,
    @SerialName("applicable_scope") val applicableScope: String = "",
    @SerialName("not_applicable") val notApplicable: String = "",
    val version: Int? = null,
    @SerialName("published_at") val publishedAt: String? = null,
    val duration: String? = null,
    @SerialName("recommend_reason") val recommendReason: String = "",
)

@Serializable
data class ContentDetail(
    val id: String,
    val type: String,
    val title: String,
    @SerialName("applicable_scope") val applicableScope: String,
    @SerialName("not_applicable") val notApplicable: String,
    @SerialName("current_status") val currentStatus: String,
    val offline: Boolean = false,
    @SerialName("current_version") val currentVersion: ContentCurrentVersion? = null,
    val versions: List<ContentVersionView> = emptyList(),
    @SerialName("review_records") val reviewRecords: List<ReviewRecordView> = emptyList(),
    val disclaimer: String = "",
)

@Serializable
data class ContentCurrentVersion(
    val version: Int,
    val script: String,
    @SerialName("subtitle_text") val subtitleText: String = "",
    @SerialName("asset_key") val assetKey: String? = null,
    @SerialName("published_at") val publishedAt: String,
)

@Serializable
data class ContentVersionView(
    val version: Int,
    val script: String = "",
    @SerialName("subtitle_text") val subtitleText: String = "",
    @SerialName("published_at") val publishedAt: String? = null,
)

@Serializable
data class ReviewRecordView(
    val id: String,
    @SerialName("reviewer_role") val reviewerRole: String,
    val decision: String,
    val comment: String? = null,
    @SerialName("reviewed_at") val reviewedAt: String,
)

/** 一页分析（对应 server analyses.controller.ts） */
interface AnalysesApi {
    @POST("analyses")
    suspend fun create(@Body body: CreateAnalysisRequest): Response<ApiResponse<CreateAnalysisResult>>

    @GET("analyses/{id}")
    suspend fun detail(@Path("id") id: String): Response<ApiResponse<AnalysisView>>

    @GET("analyses/task/{taskId}")
    suspend fun task(@Path("taskId") taskId: String): Response<ApiResponse<AnalysisTaskView>>

    /** 某病程最新一页分析（没有则返回 null） */
    @GET("analyses/by-episode/{episodeId}")
    suspend fun latestByEpisode(@Path("episodeId") episodeId: String): Response<ApiResponse<AnalysisView?>>
}

@Serializable
data class CreateAnalysisResult(
    val status: String = "queued",
    @SerialName("task_id") val taskId: String = "",
    @SerialName("safety_notice") val safetyNotice: SafetyNotice? = null,
)

@Serializable
data class AnalysisView(
    val id: String,
    @SerialName("episode_id") val episodeId: String,
    val version: Int = 1,
    @SerialName("model_release_id") val modelReleaseId: String? = null,
    @SerialName("safety_flag") val safetyFlag: String = "none",
    @SerialName("created_at") val createdAt: String,
    val sections: AnalysisSections,
    /** 检索快照是 JSON 对象（query_terms 等是数组），用 JsonObject 承载 */
    @SerialName("retrieval_snapshot") val retrievalSnapshot: JsonObject? = null,
    val disclaimer: String = "系统生成内容，仅供参考，不作诊断",
)

@Serializable
data class AnalysisSections(
    val known: List<KnownItem> = emptyList(),
    val explain: List<ExplainItem> = emptyList(),
    val unknown: List<String> = emptyList(),
    val next: List<NextItem> = emptyList(),
    val videos: List<VideoItem> = emptyList(),
    val meta: AnalysisMeta = AnalysisMeta(),
)

@Serializable
data class KnownItem(
    val text: String,
    val source: String,
    @SerialName("care_event_id") val careEventId: String? = null,
)

@Serializable
data class ExplainItem(
    val text: String,
    val citations: List<Citation> = emptyList(),
)

@Serializable
data class Citation(
    @SerialName("evidence_doc_id") val evidenceDocId: String,
    @SerialName("doc_title") val docTitle: String,
    val statement: String,
    val supported: Boolean = true,
)

@Serializable
data class NextItem(
    val text: String,
    val type: String = "下一步",
)

@Serializable
data class VideoItem(
    @SerialName("content_item_id") val contentItemId: String,
    val title: String,
    val reason: String = "",
)

@Serializable
data class AnalysisMeta(
    @SerialName("model_release") val modelRelease: String = "",
    @SerialName("generated_at") val generatedAt: String = "",
    val version: Int = 1,
    @SerialName("content_lib_version") val contentLibVersion: String = "",
    val disclaimer: String = "系统生成内容，仅供参考，不作诊断",
)

/** 任务状态（GET /analyses/task/{taskId}） */
@Serializable
data class AnalysisTaskView(
    val status: String,
    @SerialName("task_id") val taskId: String,
    val attempts: Int = 0,
    val analysis: AnalysisView? = null,
    val reason: String? = null,
    val fallback: AnalysisSections? = null,
)

/** 报告录入与结构化核对（对应 server reports.controller.ts） */
interface ReportsApi {
    @POST("reports")
    suspend fun create(@Body body: CreateReportRequest): Response<ApiResponse<ReportView>>

    @POST("reports/ocr")
    suspend fun ocr(): Response<ApiResponse<OcrResult>>

    @GET("reports/{id}")
    suspend fun detail(@Path("id") id: String): Response<ApiResponse<ReportView>>

    @GET("episodes/{id}/reports")
    suspend fun listByEpisode(@Path("id") id: String): Response<ApiResponse<List<ReportView>>>
}

@Serializable
data class ReportView(
    val id: String,
    @SerialName("care_event_id") val careEventId: String,
    @SerialName("episode_id") val episodeId: String,
    @SerialName("report_date") val reportDate: String? = null,
    @SerialName("raw_text") val rawText: String,
    @SerialName("extracted_terms") val extractedTerms: List<ExtractedTerm> = emptyList(),
    @SerialName("source_type") val sourceType: String = "报告原文",
    @SerialName("verify_status") val verifyStatus: String = "尚未确认",
    @SerialName("occurred_at") val occurredAt: String,
    @SerialName("safety_notice") val safetyNotice: SafetyNotice? = null,
)

@Serializable
data class ExtractedTerm(
    val term: String,
    val meaning: String? = null,
    val start: Int = 0,
    val end: Int = 0,
)

@Serializable
data class OcrResult(
    val text: String,
    val simulated: Boolean = true,
    val message: String? = null,
)

/** 问与解释（对应 server qa.controller.ts） */
interface QaApi {
    @POST("qa/sessions")
    suspend fun createSession(@Body body: CreateQaSessionRequest): Response<ApiResponse<QaSessionDetail>>

    @GET("qa/sessions")
    suspend fun listSessions(): Response<ApiResponse<List<QaSessionListItem>>>

    @GET("qa/sessions/{id}")
    suspend fun session(@Path("id") id: String): Response<ApiResponse<QaSessionDetail>>

    @POST("qa/sessions/{id}/messages")
    suspend fun ask(
        @Path("id") id: String,
        @Body body: AskRequest,
    ): Response<ApiResponse<AskResult>>

    @POST("qa/sessions/{id}/close")
    suspend fun close(@Path("id") id: String): Response<ApiResponse<QaCloseResult>>
}

@Serializable
data class QaCitation(
    val kind: String,
    @SerialName("evidence_doc_id") val evidenceDocId: String? = null,
    @SerialName("care_event_id") val careEventId: String? = null,
    @SerialName("analysis_id") val analysisId: String? = null,
    @SerialName("source_label") val sourceLabel: String? = null,
    val statement: String? = null,
)

@Serializable
data class QaMessageView(
    val id: String,
    val role: String,
    val content: String,
    val citations: List<QaCitation> = emptyList(),
    val refused: Boolean = false,
    @SerialName("followup_question") val followupQuestion: String? = null,
    @SerialName("add_to_followup") val addToFollowup: Boolean = false,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class QaSessionDetail(
    val id: String,
    @SerialName("episode_id") val episodeId: String? = null,
    @SerialName("created_at") val createdAt: String,
    val messages: List<QaMessageView> = emptyList(),
)

@Serializable
data class QaSessionListItem(
    val id: String,
    @SerialName("episode_id") val episodeId: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("message_count") val messageCount: Int = 0,
    @SerialName("last_message") val lastMessage: QaLastMessage? = null,
)

@Serializable
data class QaLastMessage(
    val role: String = "assistant",
    val content: String = "",
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class AskResult(
    @SerialName("session_id") val sessionId: String,
    @SerialName("user_message_id") val userMessageId: String = "",
    @SerialName("message_id") val messageId: String = "",
    val reply: String = "",
    val refused: Boolean = false,
    @SerialName("followup_question") val followupQuestion: String? = null,
    @SerialName("add_to_followup") val addToFollowup: Boolean = false,
    @SerialName("close_round") val closeRound: Boolean = false,
    val citations: List<QaCitation> = emptyList(),
    @SerialName("safety_notice") val safetyNotice: SafetyNotice? = null,
    val disclaimer: String = "",
    val context: AskContext = AskContext(),
)

@Serializable
data class AskContext(
    @SerialName("episode_id") val episodeId: String? = null,
    @SerialName("analysis_id") val analysisId: String? = null,
    @SerialName("analysis_version") val analysisVersion: Int? = null,
)

@Serializable
data class QaCloseResult(
    @SerialName("session_id") val sessionId: String,
    @SerialName("episode_id") val episodeId: String? = null,
    val closed: Boolean = false,
    @SerialName("closed_at") val closedAt: String = "",
)

/** 复诊摘要（对应 server followup.controller.ts，路径 /episodes/:id/followup） */
interface FollowupApi {
    @GET("episodes/{id}/followup")
    suspend fun latest(@Path("id") id: String): Response<ApiResponse<FollowupSummaryView>>

    @POST("episodes/{id}/followup/generate")
    suspend fun generate(@Path("id") id: String): Response<ApiResponse<FollowupSummaryView>>

    @retrofit2.http.PUT("episodes/{id}/followup/{summaryId}")
    suspend fun correct(
        @Path("id") id: String,
        @Path("summaryId") summaryId: String,
        @Body body: CorrectFollowupRequest,
    ): Response<ApiResponse<FollowupSummaryView>>

    @POST("episodes/{id}/followup/{summaryId}/export")
    suspend fun export(
        @Path("id") id: String,
        @Path("summaryId") summaryId: String,
        @Body body: ExportFollowupRequest,
    ): Response<ApiResponse<FollowupExportView>>

    @POST("episodes/{id}/followup-questions")
    suspend fun addQuestion(
        @Path("id") id: String,
        @Body body: AddFollowupQuestionRequest,
    ): Response<ApiResponse<FollowupQuestionResult>>
}

@Serializable
data class FollowupQuestionResult(val id: String = "")

@Serializable
data class FollowupSummaryView(
    val id: String,
    @SerialName("episode_id") val episodeId: String,
    val content: FollowupContentView,
    @SerialName("generated_at") val generatedAt: String? = null,
    val corrected: Boolean = false,
    val exported: Boolean = false,
    @SerialName("export_format") val exportFormat: String? = null,
    @SerialName("exported_at") val exportedAt: String? = null,
    val disclaimer: String = "仅整理你提供的信息，不构成诊断",
)

@Serializable
data class FollowupContentView(
    val sections: List<FollowupSection> = emptyList(),
    @SerialName("generated_at") val generatedAt: String? = null,
    val corrected: Boolean = false,
    @SerialName("corrected_at") val correctedAt: String? = null,
    val disclaimer: String = "仅整理你提供的信息，不构成诊断",
)

@Serializable
data class FollowupSection(
    val key: String,
    val title: String,
    val items: List<FollowupItem> = emptyList(),
)

@Serializable
data class FollowupItem(
    val text: String,
    val source: String = "自述",
    @SerialName("verify_status") val verifyStatus: String? = null,
    @SerialName("care_event_id") val careEventId: String? = null,
    val from: String? = null,
)

@Serializable
data class FollowupExportView(
    val id: String,
    @SerialName("episode_id") val episodeId: String,
    val format: String,
    @SerialName("export_format") val exportFormat: String = format,
    @SerialName("exported_at") val exportedAt: String = "",
    val text: String = "",
    @SerialName("browser_print") val browserPrint: Boolean = false,
    val note: String = "",
)

/** 用户端反馈（对应 server feedback.controller.ts） */
interface FeedbackApi {
    @POST("feedback")
    suspend fun help(@Body body: HelpFeedbackRequest): Response<ApiResponse<FeedbackItem>>

    @POST("feedback/error-report")
    suspend fun errorReport(@Body body: ErrorReportRequest): Response<ApiResponse<FeedbackItem>>

    @GET("feedback/mine")
    suspend fun mine(): Response<ApiResponse<List<FeedbackItem>>>

    @GET("feedback/{id}")
    suspend fun detail(@Path("id") id: String): Response<ApiResponse<FeedbackItem>>
}

@Serializable
data class FeedbackItem(
    val id: String,
    val type: String = "feedback",
    @SerialName("analysis_id") val analysisId: String? = null,
    @SerialName("help_type") val helpType: String? = null,
    @SerialName("unsolved_question") val unsolvedQuestion: String? = null,
    @SerialName("content_item_id") val contentItemId: String? = null,
    val category: String? = null,
    val description: String? = null,
    val severity: String? = null,
    val status: String = "待处理",
    @SerialName("created_at") val createdAt: String,
)
