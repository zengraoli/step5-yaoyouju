package com.yaoyouju.android.data

import com.yaoyouju.android.core.datastore.TokenStore
import com.yaoyouju.android.core.net.ApiException
import com.yaoyouju.android.core.net.AuthApi
import com.yaoyouju.android.core.net.ConsentItem
import com.yaoyouju.android.core.net.EmergencyNotice
import com.yaoyouju.android.core.net.LoginResult
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.SafetyApi
import com.yaoyouju.android.core.net.SwitchesApi
import com.yaoyouju.android.core.net.SwitchState
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
        val res = handleResponse(api.sendSmsCode(mapOf("phone" to phone)))
        return res["masked"]?.toString() ?: ""
    }

    suspend fun login(phone: String, code: String): LoginResult {
        val result = handleResponse(api.login(mapOf("phone" to phone, "code" to code)))
        tokenStore.saveToken(result.token)
        return result
    }

    suspend fun me() = handleResponse(api.me())

    suspend fun consents(): List<ConsentItem> = handleResponse(api.consents())

    /** 同意某项范围（单独勾选） */
    suspend fun grantConsent(scope: String): List<ConsentItem> =
        handleResponse(api.grantConsent(mapOf("scope" to scope)))

    /** 撤回同意（立即生效） */
    suspend fun revokeConsent(scope: String): List<ConsentItem> =
        handleResponse(api.revokeConsent(scope))

    suspend fun logout() {
        tokenStore.clear()
    }
}

/** 就医提示（公开接口，无需登录） */
class SafetyRepository(private val api: SafetyApi) {
    suspend fun emergencyNotice(): EmergencyNotice = handleResponse(api.emergencyNotice())
}

/** 功能开关（公开读取） */
class SwitchesRepository(private val api: SwitchesApi) {
    suspend fun switches(): List<SwitchState> = handleResponse(api.switches())
}

/** 简单容器：演示用（生产可换 Hilt） */
object ServiceLocator {
    val tokenStore: TokenStore by lazy { com.yaoyouju.android.YyjApplication.instance.tokenStore }
    val authApi: AuthApi by lazy { NetworkModule.api() }
    val safetyApi: SafetyApi by lazy { NetworkModule.api() }
    val switchesApi: SwitchesApi by lazy { NetworkModule.api() }
    val authRepository: AuthRepository by lazy { AuthRepository(authApi, tokenStore) }
    val safetyRepository: SafetyRepository by lazy { SafetyRepository(safetyApi) }
    val switchesRepository: SwitchesRepository by lazy { SwitchesRepository(switchesApi) }
}

/** ApiException 别名，便于 UI 层捕获 */
typealias ApiError = ApiException
