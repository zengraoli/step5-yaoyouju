package com.yaoyouju.android.core.net

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * 认证与同意接口（对应 server auth.controller.ts）
 */
interface AuthApi {

    @POST("auth/sms-code")
    suspend fun sendSmsCode(@Body body: Map<String, String>): ApiResponse<Map<String, Any>>

    @POST("auth/login")
    suspend fun login(@Body body: Map<String, String>): ApiResponse<LoginResult>

    @GET("auth/me")
    suspend fun me(): ApiResponse<MeResult>

    @GET("auth/consents")
    suspend fun consents(): ApiResponse<List<ConsentItem>>

    @POST("auth/consents")
    suspend fun grantConsent(@Body body: Map<String, String>): ApiResponse<List<ConsentItem>>

    @POST("auth/consents/{scope}/revoke")
    suspend fun revokeConsent(@Path("scope") scope: String): ApiResponse<List<ConsentItem>>
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
    suspend fun emergencyNotice(): ApiResponse<EmergencyNotice>
}

/** 功能开关（公开读取） */
interface SwitchesApi {
    @GET("switches")
    suspend fun switches(): ApiResponse<List<SwitchState>>
}
