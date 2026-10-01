package com.yaoyouju.android.ui.screens

import com.yaoyouju.android.core.net.ApiException
import java.io.IOException

/**
 * 异常 → 用户可见的中文提示（验收反馈第 35 条：不要把英文技术异常原文显示给用户）。
 * - 业务错误（ApiException）：用服务端返回的中文 message；
 * - 网络层异常（IOException / 超时 / DNS）：统一「网络连接失败，请检查网络后重试」；
 * - 其他：给中文兜底，不展示类名或堆栈。
 */
fun Throwable.userMessage(): String = when (this) {
    is ApiException -> if (message.isNullOrBlank()) "服务暂时不可用，请稍后重试" else message!!
    is IOException -> "网络连接失败，请检查网络后重试"
    else -> message?.takeIf { it.isNotBlank() && !it.startsWith("Failed to connect") && !it.startsWith("java.") }
        ?: "服务暂时不可用，请稍后重试"
}

/** 是否网络层异常（用于进入服务不可用页 / 提供重试） */
fun Throwable.isNetworkError(): Boolean =
    this is IOException || (this is ApiException && network)
