package com.yaoyouju.android.core.net

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
    suspend fun create(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<ApiResponse<EpisodeItem>>

    @GET("episodes/{id}")
    suspend fun detail(@Path("id") id: String): Response<ApiResponse<EpisodeDetail>>

    @PATCH("episodes/{id}")
    suspend fun update(
        @Path("id") id: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?>,
    ): Response<ApiResponse<EpisodeItem>>

    @GET("episodes/{id}/today")
    suspend fun today(@Path("id") id: String): Response<ApiResponse<TodayStatus>>

    @PATCH("episodes/{id}/events/{eventId}")
    suspend fun updateEvent(
        @Path("id") id: String,
        @Path("eventId") eventId: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?>,
    ): Response<ApiResponse<CareEventView>>

    @POST("episodes/{id}/today-logs")
    suspend fun saveTodayLog(
        @Path("id") id: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?>,
    ): Response<ApiResponse<EpisodeItem>>
}

@kotlinx.serialization.Serializable
data class EpisodeItem(
    val id: String,
    val title: String,
    @kotlinx.serialization.SerialName("start_date") val startDate: String? = null,
    @kotlinx.serialization.SerialName("status") val status: String = "进行中",
    @kotlinx.serialization.SerialName("created_at") val createdAt: String,
)

@kotlinx.serialization.Serializable
data class EpisodeDetail(
    val id: String,
    val title: String,
    @kotlinx.serialization.SerialName("start_date") val startDate: String? = null,
    val events: List<CareEventView> = emptyList(),
    @kotlinx.serialization.SerialName("analysis_count") val analysisCount: Int = 0,
    @kotlinx.serialization.SerialName("latest_analysis_id") val latestAnalysisId: String? = null,
)

@kotlinx.serialization.Serializable
data class CareEventView(
    val id: String,
    @kotlinx.serialization.SerialName("event_type") val eventType: String,
    val label: String,
    @kotlinx.serialization.SerialName("detail") val detail: String? = null,
    @kotlinx.serialization.SerialName("verify_status") val verifyStatus: String? = null,
    @kotlinx.serialization.SerialName("source") val source: String? = null,
    @kotlinx.serialization.SerialName("event_date") val eventDate: String? = null,
    @kotlinx.serialization.SerialName("created_at") val createdAt: String? = null,
)

@kotlinx.serialization.Serializable
data class TodayStatus(
    val recorded: Boolean,
    @kotlinx.serialization.SerialName("log_id") val logId: String? = null,
    @kotlinx.serialization.SerialName("log_date") val logDate: String? = null,
    @kotlinx.serialization.SerialName("pain_score") val painScore: Int? = null,
)

/** 审核内容（对应 server contents.controller.ts） */
interface ContentsApi {
    @GET("contents")
    suspend fun list(
        @Query("page") page: Int = 1,
        @Query("page_size") pageSize: Int = 10,
    ): Response<ApiResponse<ContentListResponse>>
}

@kotlinx.serialization.Serializable
data class ContentListResponse(
    val list: List<ContentListItem> = emptyList(),
    val total: Int = 0,
)

@kotlinx.serialization.Serializable
data class ContentListItem(
    val id: String,
    val title: String,
    @kotlinx.serialization.SerialName("content_type") val contentType: String,
    val summary: String? = null,
    @kotlinx.serialization.SerialName("recommend_reason") val recommendReason: String? = null,
    @kotlinx.serialization.SerialName("source_type") val sourceType: String? = null,
    @kotlinx.serialization.SerialName("status") val status: String? = null,
)

/** 一页分析（对应 server analyses.controller.ts） */
interface AnalysesApi {
    @POST("analyses")
    suspend fun create(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<ApiResponse<AnalysisTaskView>>

    @GET("analyses/{id}")
    suspend fun detail(@Path("id") id: String): Response<ApiResponse<AnalysisView>>

    @GET("analyses/task/{taskId}")
    suspend fun task(@Path("taskId") taskId: String): Response<ApiResponse<AnalysisTaskView>>
}

@kotlinx.serialization.Serializable
data class AnalysisView(
    val id: String,
    @kotlinx.serialization.SerialName("episode_id") val episodeId: String,
    val version: Int = 1,
    @kotlinx.serialization.SerialName("model_release_id") val modelReleaseId: String? = null,
    @kotlinx.serialization.SerialName("safety_flag") val safetyFlag: String = "none",
    @kotlinx.serialization.SerialName("created_at") val createdAt: String,
    val sections: AnalysisSections,
    @kotlinx.serialization.SerialName("retrieval_snapshot") val retrievalSnapshot: Map<String, String>? = null,
    val disclaimer: String = "系统生成内容，仅供参考，不作诊断",
)

@kotlinx.serialization.Serializable
data class AnalysisSections(
    val known: List<KnownItem> = emptyList(),
    val explain: List<ExplainItem> = emptyList(),
    val unknown: List<String> = emptyList(),
    val next: List<NextItem> = emptyList(),
    val videos: List<VideoItem> = emptyList(),
    val meta: AnalysisMeta = AnalysisMeta(),
)

@kotlinx.serialization.Serializable
data class KnownItem(
    val text: String,
    val source: String,
    @kotlinx.serialization.SerialName("care_event_id") val careEventId: String? = null,
)

@kotlinx.serialization.Serializable
data class ExplainItem(
    val text: String,
    val citations: List<Citation> = emptyList(),
)

@kotlinx.serialization.Serializable
data class Citation(
    @kotlinx.serialization.SerialName("evidence_doc_id") val evidenceDocId: String,
    @kotlinx.serialization.SerialName("doc_title") val docTitle: String,
    val statement: String,
    val supported: Boolean = true,
)

@kotlinx.serialization.Serializable
data class NextItem(
    val text: String,
    val type: String = "下一步",
)

@kotlinx.serialization.Serializable
data class VideoItem(
    @kotlinx.serialization.SerialName("content_item_id") val contentItemId: String,
    val title: String,
    val reason: String = "",
)

@kotlinx.serialization.Serializable
data class AnalysisMeta(
    @kotlinx.serialization.SerialName("model_release") val modelRelease: String = "mock-2026.09",
    @kotlinx.serialization.SerialName("generated_at") val generatedAt: String = "",
    val version: Int = 1,
    val disclaimer: String = "系统生成内容，仅供参考，不作诊断",
)

/** 任务状态（GET /analyses/task/{taskId}） */
@kotlinx.serialization.Serializable
data class AnalysisTaskView(
    val status: String,
    @kotlinx.serialization.SerialName("task_id") val taskId: String,
    val attempts: Int = 0,
    val analysis: AnalysisView? = null,
    val reason: String? = null,
    val fallback: AnalysisSections? = null,
)

/** 复诊摘要（对应 server followup.controller.ts，路径 /episodes/:id/followup） */
interface FollowupApi {
    @GET("episodes/{id}/followup")
    suspend fun latest(@Path("id") id: String): Response<ApiResponse<FollowupSummaryView>>
}

@kotlinx.serialization.Serializable
data class FollowupSummaryView(
    val id: String,
    @kotlinx.serialization.SerialName("episode_id") val episodeId: String,
    val content: String? = null,
    @kotlinx.serialization.SerialName("created_at") val createdAt: String? = null,
)

/** 报告录入与结构化核对（对应 server reports.controller.ts） */
interface ReportsApi {
    @POST("reports")
    suspend fun create(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<ApiResponse<ReportView>>

    @POST("reports/ocr")
    suspend fun ocr(): Response<ApiResponse<OcrResult>>

    @GET("reports/{id}")
    suspend fun detail(@Path("id") id: String): Response<ApiResponse<ReportView>>

    @GET("episodes/{id}/reports")
    suspend fun listByEpisode(@Path("id") id: String): Response<ApiResponse<List<ReportView>>>

    @GET("episodes/{id}/structured")
    suspend fun structured(@Path("id") id: String): Response<ApiResponse<StructuredResponse>>
}

@kotlinx.serialization.Serializable
data class ReportView(
    val id: String,
    @kotlinx.serialization.SerialName("care_event_id") val careEventId: String,
    @kotlinx.serialization.SerialName("episode_id") val episodeId: String,
    @kotlinx.serialization.SerialName("report_date") val reportDate: String? = null,
    @kotlinx.serialization.SerialName("raw_text") val rawText: String,
    @kotlinx.serialization.SerialName("extracted_terms") val extractedTerms: List<ExtractedTerm> = emptyList(),
    @kotlinx.serialization.SerialName("source_type") val sourceType: String = "报告",
    @kotlinx.serialization.SerialName("verify_status") val verifyStatus: String = "尚未确认",
    @kotlinx.serialization.SerialName("occurred_at") val occurredAt: String,
)

@kotlinx.serialization.Serializable
data class ExtractedTerm(
    val term: String,
    val meaning: String? = null,
    val position: Int? = null,
)

@kotlinx.serialization.Serializable
data class OcrResult(
    val text: String,
    val simulated: Boolean = true,
    val message: String? = null,
)

@kotlinx.serialization.Serializable
data class StructuredResponse(
    val items: List<StructuredItem> = emptyList(),
    val summary: StructuredSummary = StructuredSummary(),
)

@kotlinx.serialization.Serializable
data class StructuredItem(
    @kotlinx.serialization.SerialName("care_event_id") val careEventId: String,
    @kotlinx.serialization.SerialName("event_type") val eventType: String,
    @kotlinx.serialization.SerialName("source_type") val sourceType: String,
    @kotlinx.serialization.SerialName("occurred_at") val occurredAt: String? = null,
    @kotlinx.serialization.SerialName("reported_at") val reportedAt: String? = null,
    @kotlinx.serialization.SerialName("verify_status") val verifyStatus: String = "尚未确认",
    @kotlinx.serialization.SerialName("needs_confirm") val needsConfirm: Boolean = false,
    @kotlinx.serialization.SerialName("raw_text") val rawText: String? = null,
    val report: StructuredReport? = null,
)

@kotlinx.serialization.Serializable
data class StructuredReport(
    val id: String,
    @kotlinx.serialization.SerialName("report_date") val reportDate: String? = null,
    @kotlinx.serialization.SerialName("extracted_terms") val extractedTerms: List<ExtractedTerm> = emptyList(),
)

@kotlinx.serialization.Serializable
data class StructuredSummary(
    val total: Int = 0,
    val confirmed: Int = 0,
    val unconfirmed: Int = 0,
    val conflict: Int = 0,
)
