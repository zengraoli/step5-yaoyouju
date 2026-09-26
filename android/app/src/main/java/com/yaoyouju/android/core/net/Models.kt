package com.yaoyouju.android.core.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

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
    @SerialName("granted_at") val grantedAt: String,
    @SerialName("revoked_at") val revokedAt: String? = null,
)

/** 就医提示内容（GET /safety/emergency-notice 与 409 响应 data） */
@Serializable
data class EmergencyNotice(
    val title: String,
    val headline: String,
    val body: String,
    @SerialName("offline_note") val offlineNote: String,
    val actions: List<NoticeAction> = emptyList(),
    @SerialName("bring_list") val bringList: List<String> = emptyList(),
    @SerialName("summary_action") val summaryAction: NoticeAction? = null,
    @SerialName("footer_note") val footerNote: String,
    val matched: List<MatchedRule> = emptyList(),
    @SerialName("rule_set_version") val ruleSetVersion: String = "",
)

@Serializable
data class NoticeAction(
    val type: String,
    val label: String,
)

/** 命中的安全规则（RF-xx） */
@Serializable
data class MatchedRule(
    @SerialName("rule_code") val ruleCode: String,
    val label: String,
    val severity: String,
    val action: String,
    val advice: String,
    val excerpt: String = "",
)

/** 功能开关状态 */
@Serializable
data class SwitchState(
    val key: String,
    val enabled: Boolean,
    val reason: String? = null,
    @SerialName("updated_at") val updatedAt: String = "",
)
