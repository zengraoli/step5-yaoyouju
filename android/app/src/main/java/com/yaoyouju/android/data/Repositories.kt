package com.yaoyouju.android.data

import com.yaoyouju.android.core.datastore.TokenStore
import com.yaoyouju.android.core.net.AccountExport
import com.yaoyouju.android.core.net.AnalysesApi
import com.yaoyouju.android.core.net.ApiException
import com.yaoyouju.android.core.net.AuthApi
import com.yaoyouju.android.core.net.ConsentItem
import com.yaoyouju.android.core.net.ConsentRequest
import com.yaoyouju.android.core.net.ContentsApi
import com.yaoyouju.android.core.net.CreateAnalysisRequest
import com.yaoyouju.android.core.net.CreateCareEventRequest
import com.yaoyouju.android.core.net.CreateEpisodeRequest
import com.yaoyouju.android.core.net.CreateReportRequest
import com.yaoyouju.android.core.net.DeleteAccountRequest
import com.yaoyouju.android.core.net.EmergencyNotice
import com.yaoyouju.android.core.net.EpisodeItem
import com.yaoyouju.android.core.net.EpisodesApi
import com.yaoyouju.android.core.net.FeedbackApi
import com.yaoyouju.android.core.net.FollowupApi
import com.yaoyouju.android.core.net.LogTodayRequest
import com.yaoyouju.android.core.net.LoginRequest
import com.yaoyouju.android.core.net.LoginResult
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.QaApi
import com.yaoyouju.android.core.net.ReportsApi
import com.yaoyouju.android.core.net.SafetyApi
import com.yaoyouju.android.core.net.SmsCodeRequest
import com.yaoyouju.android.core.net.SwitchesApi
import com.yaoyouju.android.core.net.SwitchState
import com.yaoyouju.android.core.net.SymptomLogView
import com.yaoyouju.android.core.net.TimelineGroup
import com.yaoyouju.android.core.net.TokenProvider
import com.yaoyouju.android.core.net.UpdateEpisodeRequest
import com.yaoyouju.android.core.net.handleResponse
import kotlinx.coroutines.flow.Flow

/**
 * 认证仓库：登录 / 同意 / 令牌持久化。
 * 演示实现：验证码固定 123456（server 侧校验），短信只写脱敏日志。
 */
class AuthRepository(
    private val api: AuthApi,
    private val tokenStore: TokenStore,
) {
    val token: Flow<String> = tokenStore.token

    suspend fun sendSmsCode(phone: String): String {
        val res = handleResponse(api.sendSmsCode(SmsCodeRequest(phone)))
        return res.masked
    }

    suspend fun login(phone: String, code: String): LoginResult {
        val result = handleResponse(api.login(LoginRequest(phone, code)))
        TokenProvider.token = result.token
        tokenStore.saveToken(result.token)
        return result
    }

    /** 用本地保存的令牌恢复登录态（冷启动） */
    fun restoreToken(saved: String) {
        TokenProvider.token = saved
    }

    /** 退出登录：先吊销服务端令牌，再清理本地（旧令牌立即失效） */
    suspend fun logout() {
        try {
            handleResponse(api.logout())
        } catch (_: Exception) {
            // 网络异常也允许本地退出
        }
        TokenProvider.token = ""
        tokenStore.clear()
    }

    /** 导出我的数据（JSON 全文） */
    suspend fun exportData(): String =
        NetworkModule.json.encodeToString(AccountExport.serializer(), handleResponse(api.exportData()))

    /** 申请删除账户（验证码二次确认 → 24 小时冷静期） */
    suspend fun requestDelete(phone: String, code: String) =
        handleResponse(api.requestDelete(DeleteAccountRequest(phone, code)))

    /** 确认删除（冷静期后生效） */
    suspend fun confirmDelete(phone: String, code: String) =
        handleResponse(api.confirmDelete(DeleteAccountRequest(phone, code)))

    /** 取消删除申请 */
    suspend fun cancelDelete() = handleResponse(api.cancelDelete())

    suspend fun me() = handleResponse(api.me())

    suspend fun consents(): List<ConsentItem> = handleResponse(api.consents())

    /** 同意某项范围（单独勾选） */
    suspend fun grantConsent(scope: String): List<ConsentItem> =
        handleResponse(api.grantConsent(ConsentRequest(scope)))

    /** 撤回同意（立即生效） */
    suspend fun revokeConsent(scope: String): List<ConsentItem> =
        handleResponse(api.revokeConsent(scope))
}

/** 就医提示（公开接口，无需登录） */
class SafetyRepository(private val api: SafetyApi) {
    suspend fun emergencyNotice(): EmergencyNotice = handleResponse(api.emergencyNotice())
}

/** 功能开关（公开读取） */
class SwitchesRepository(private val api: SwitchesApi) {
    suspend fun switches(): List<SwitchState> = handleResponse(api.switches())
}

/** 病程 / 报告 / 分析 / 问与解释 / 复诊 / 反馈仓库（用户端全部写操作） */
class EpisodeRepository(private val api: EpisodesApi) {
    suspend fun list(): List<EpisodeItem> = handleResponse(api.list())

    suspend fun create(title: String, onsetDate: String? = null, onsetCertainty: String? = null) =
        handleResponse(api.create(CreateEpisodeRequest(title, onsetDate, onsetCertainty)))

    suspend fun detail(id: String) = handleResponse(api.detail(id))

    suspend fun update(id: String, body: UpdateEpisodeRequest) = handleResponse(api.update(id, body))

    suspend fun addEvent(id: String, body: CreateCareEventRequest): com.yaoyouju.android.core.net.CareEventView =
        handleResponse(api.addEvent(id, body))

    suspend fun today(id: String) = handleResponse(api.today(id))

    suspend fun logToday(id: String, body: LogTodayRequest): SymptomLogView =
        handleResponse(api.saveTodayLog(id, body))

    suspend fun timeline(id: String): List<TimelineGroup> = handleResponse(api.timeline(id))

    suspend fun structured(id: String) = handleResponse(api.structured(id))
}

class ReportRepository(private val api: ReportsApi) {
    suspend fun create(body: CreateReportRequest): com.yaoyouju.android.core.net.ReportView =
        handleResponse(api.create(body))

    suspend fun detail(id: String) = handleResponse(api.detail(id))
    suspend fun listByEpisode(id: String): List<com.yaoyouju.android.core.net.ReportView> =
        handleResponse(api.listByEpisode(id))
}

class AnalysisRepository(private val api: AnalysesApi) {
    suspend fun create(body: CreateAnalysisRequest): com.yaoyouju.android.core.net.CreateAnalysisResult =
        handleResponse(api.create(body))

    suspend fun task(taskId: String) = handleResponse(api.task(taskId))
    suspend fun detail(id: String) = handleResponse(api.detail(id))
    suspend fun latest(episodeId: String) = handleResponse(api.latestByEpisode(episodeId))
}

class QaRepository(private val api: QaApi) {
    suspend fun createSession(episodeId: String?) =
        handleResponse(api.createSession(com.yaoyouju.android.core.net.CreateQaSessionRequest(episodeId)))

    suspend fun sessions(): List<com.yaoyouju.android.core.net.QaSessionListItem> =
        handleResponse(api.listSessions())

    suspend fun session(id: String) = handleResponse(api.session(id))
    suspend fun ask(id: String, content: String): com.yaoyouju.android.core.net.AskResult =
        handleResponse(api.ask(id, com.yaoyouju.android.core.net.AskRequest(content)))

    suspend fun close(id: String) = handleResponse(api.close(id))
}

class FollowupRepository(private val api: FollowupApi) {
    suspend fun latest(id: String) = handleResponse(api.latest(id))
    suspend fun generate(id: String) = handleResponse(api.generate(id))
    suspend fun correct(
        id: String,
        summaryId: String,
        body: com.yaoyouju.android.core.net.CorrectFollowupRequest,
    ) = handleResponse(api.correct(id, summaryId, body))

    suspend fun export(id: String, summaryId: String, format: String) =
        handleResponse(api.export(id, summaryId, com.yaoyouju.android.core.net.ExportFollowupRequest(format)))

    suspend fun addQuestion(id: String, question: String) =
        handleResponse(api.addQuestion(id, com.yaoyouju.android.core.net.AddFollowupQuestionRequest(question)))
}

class ContentRepository(private val api: ContentsApi) {
    suspend fun list(type: String? = null): List<com.yaoyouju.android.core.net.ContentListItem> =
        handleResponse(api.list(type))

    suspend fun detail(id: String) = handleResponse(api.detail(id))
}

class FeedbackRepository(private val api: FeedbackApi) {
    suspend fun help(analysisId: String, helpType: String, unsolvedQuestion: String? = null) =
        handleResponse(
            api.help(
                com.yaoyouju.android.core.net.HelpFeedbackRequest(analysisId, helpType, unsolvedQuestion),
            ),
        )

    suspend fun errorReport(
        analysisId: String?,
        contentItemId: String?,
        category: String,
        description: String,
        severity: String? = null,
    ) = handleResponse(
        api.errorReport(
            com.yaoyouju.android.core.net.ErrorReportRequest(
                analysisId,
                contentItemId,
                category,
                description,
                severity,
            ),
        ),
    )

    suspend fun mine(): List<com.yaoyouju.android.core.net.FeedbackItem> = handleResponse(api.mine())
    suspend fun detail(id: String) = handleResponse(api.detail(id))
}

/** 简单容器：演示用（生产可换 Hilt） */
object ServiceLocator {
    val tokenStore: TokenStore by lazy { com.yaoyouju.android.YyjApplication.instance.tokenStore }
    val authApi: AuthApi by lazy { NetworkModule.api() }
    val safetyApi: SafetyApi by lazy { NetworkModule.api() }
    val switchesApi: SwitchesApi by lazy { NetworkModule.api() }
    val episodesApi: EpisodesApi by lazy { NetworkModule.api() }
    val reportsApi: ReportsApi by lazy { NetworkModule.api() }
    val analysesApi: AnalysesApi by lazy { NetworkModule.api() }
    val qaApi: QaApi by lazy { NetworkModule.api() }
    val followupApi: FollowupApi by lazy { NetworkModule.api() }
    val contentsApi: ContentsApi by lazy { NetworkModule.api() }
    val feedbackApi: FeedbackApi by lazy { NetworkModule.api() }
    val authRepository: AuthRepository by lazy { AuthRepository(authApi, tokenStore) }
    val safetyRepository: SafetyRepository by lazy { SafetyRepository(safetyApi) }
    val switchesRepository: SwitchesRepository by lazy { SwitchesRepository(switchesApi) }
    val episodeRepository: EpisodeRepository by lazy { EpisodeRepository(episodesApi) }
    val reportRepository: ReportRepository by lazy { ReportRepository(reportsApi) }
    val analysisRepository: AnalysisRepository by lazy { AnalysisRepository(analysesApi) }
    val qaRepository: QaRepository by lazy { QaRepository(qaApi) }
    val followupRepository: FollowupRepository by lazy { FollowupRepository(followupApi) }
    val contentRepository: ContentRepository by lazy { ContentRepository(contentsApi) }
    val feedbackRepository: FeedbackRepository by lazy { FeedbackRepository(feedbackApi) }
}

/** ApiException 别名，便于 UI 层捕获 */
typealias ApiError = ApiException
