package com.yaoyouju.android.ui.screens

import androidx.navigation.NavHostController
import com.yaoyouju.android.core.net.ApiException
import com.yaoyouju.android.core.net.NetworkModule
import com.yaoyouju.android.core.net.SafetyNotice
import com.yaoyouju.android.ui.navigation.Routes
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

/**
 * 网络层异常时统一进入「服务不可用」页（A18），并带上分析任务 ID（有的话）。
 * 返回 true 表示已处理（调用方不要再弹 toast）。
 * 就医提示与已保存内容不依赖网络，因此断网时各页都往这一页走（第七轮验收反馈第 17、21 条）。
 */
fun NavHostController.openFallbackOnNetworkError(e: Throwable, taskId: String = ""): Boolean {
    if (!e.isNetworkError()) return false
    // 导航图还没设置（单元测试 / 首帧）时不跳转，避免 IllegalArgumentException
    val graphReady = runCatching { graph }.getOrNull() != null
    if (!graphReady) return false
    navigate(Routes.FALLBACK + "?taskId=" + taskId)
    return true
}

/**
 * 从异常里取「就医提示」内容（命中红旗时 40910 / 40911 的 data）。
 * 返回 (信号名顿号串, 是否 high) ；不是红旗命中返回 null。
 */
fun safetyNoticeOf(e: Throwable): Pair<String, Boolean>? {
    val api = e as? ApiException ?: return null
    if (api.code != 40910 && api.code != 40911) return null
    val raw = api.data ?: return null
    val notice = try {
        NetworkModule.json.decodeFromString<SafetyNotice>(raw)
    } catch (_: Exception) {
        return null
    }
    val labels = notice.matched.map { it.label }.filter { it.isNotBlank() }.distinct()
    if (labels.isEmpty()) return null
    val high = notice.matched.any { it.severity == "high" } || api.code == 40911
    return labels.joinToString("、") to high
}
