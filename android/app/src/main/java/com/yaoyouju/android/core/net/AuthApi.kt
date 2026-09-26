package com.yaoyouju.android.core.net

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * 认证与同意接口（对应 server auth.controller.ts）。
 * 返回 Retrofit Response 包装，便于 handleResponse 读取 HTTP 状态码
 * （安全规则命中时服务端返回 40910/40911，响应体 data 为就医提示）。
 */
interface AuthApi {

    @POST("auth/sms-code")
    suspend fun sendSmsCode(@Body body: Map<String, String>): Response<ApiResponse<Map<String, Any>>>

    @POST("auth/login")
    suspend fun login(@Body body: Map<String, String>): Response<ApiResponse<LoginResult>>

    @GET("auth/me")
    suspend fun me(): Response<ApiResponse<MeResult>>

    @GET("auth/consents")
    suspend fun consents(): Response<ApiResponse<List<ConsentItem>>>

    @POST("auth/consents")
    suspend fun grantConsent(@Body body: Map<String, String>): Response<ApiResponse<List<ConsentItem>>>

    @POST("auth/consents/{scope}/revoke")
    suspend fun revokeConsent(@Path("scope") scope: String): Response<ApiResponse<List<ConsentItem>>>
}

@kotlinx.serialization.Serializable
data class MeResult(
    val id: String,
    @kotlinx.serialization.SerialName("phone_masked") val phoneMasked: String,
    @kotlinx.serialization.SerialName("real_name_masked") val realNameMasked: String? = null,
    @kotlinx.serialization.SerialName("created_at") val createdAt: String,
    val consents: List<ConsentItem> = emptyList(),
)

/** 就医提示（公开接口，无需登录；R03：不被登录阻断） */
interface SafetyApi {
    @GET("safety/emergency-notice")
    suspend fun emergencyNotice(): Response<ApiResponse<EmergencyNotice>>
}

/** 功能开关（公开读取） */
interface SwitchesApi {
    @GET("switches")
    suspend fun switches(): Response<ApiResponse<List<SwitchState>>>
}
