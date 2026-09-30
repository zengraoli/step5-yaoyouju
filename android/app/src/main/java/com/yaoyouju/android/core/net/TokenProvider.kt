package com.yaoyouju.android.core.net

/**
 * 内存令牌提供者：OkHttp 拦截器需要同步读取令牌，
 * 登录 / 退出时由 AuthRepository 同步更新（DataStore 仍负责持久化）。
 */
object TokenProvider {
    @Volatile
    var token: String = ""

    fun bearer(): String? = token.takeIf { it.isNotBlank() }?.let { "Bearer $it" }
}
