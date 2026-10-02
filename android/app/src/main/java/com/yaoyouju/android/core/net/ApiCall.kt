package com.yaoyouju.android.core.net

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.Response
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * 统一响应处理：HTTP 2xx 且 code = 0 → data；否则抛 ApiException（中文 message）。
 * 安全规则命中（40910/40911）的响应体 data 为就医提示内容，随异常透出。
 *
 * 业务错误（4xx）时 Retrofit 把响应体放在 errorBody()、body() 为 null，
 * 因此这里必须解析 errorBody，否则会丢掉服务端的错误码与中文提示，
 * 只显示「服务暂时不可用（409）」（验收反馈第 9 条）。
 *
 * 网络层异常（连不上 / 超时 / DNS）统一转成中文提示并带 `network = true`，
 * 界面据此进入「服务不可用」页或提供重试，不把英文技术原文直接显示给用户。
 */
suspend fun <T> handleResponse(response: Response<ApiResponse<T>>): T {
    val body = response.body()
    if (response.isSuccessful && body != null && body.code == 0) {
        return body.data as T
    }
    // HTTP 错误（业务错误 / 安全规则）：解析 errorBody，保留 code + 中文 message + data
    val parsed = body ?: parseErrorBody(response)
    if (parsed != null && parsed.code != 0) {
        throw ApiException(parsed.code, parsed.message, extractData(parsed.data))
    }
    if (parsed != null) {
        // code = 0 但 HTTP 非 2xx：仍按业务错误处理
        throw ApiException(parsed.code, parsed.message, extractData(parsed.data))
    }
    // 非统一格式（网络异常 / 5xx）：中文提示，不暴露细节
    throw ApiException(
        response.code(),
        when (response.code()) {
            401 -> "请先登录"
            403 -> "没有权限执行该操作"
            404 -> "请求的内容不存在"
            in 500..599 -> "服务暂时不可用，请稍后再试"
            else -> "服务暂时不可用（${response.code()}），请稍后再试"
        },
        null,
    )
}

/** 解析 HTTP 错误响应体（{"code":…,"message":"…","data":{…}}） */
private fun <T> parseErrorBody(response: Response<ApiResponse<T>>): ApiResponse<JsonElement>? {
    val raw = try {
        response.errorBody()?.string()
    } catch (_: IOException) {
        null
    } ?: return null
    if (raw.isBlank()) return null
    return try {
        val obj = NetworkModule.json.parseToJsonElement(raw).jsonObject
        val code = obj["code"]?.jsonPrimitive?.content?.toIntOrNull() ?: return null
        val message = obj["message"]?.jsonPrimitive?.content ?: "请求失败，请稍后重试"
        ApiResponse(code = code, data = obj["data"], message = message)
    } catch (_: Exception) {
        null
    }
}

/** 网络层异常 → 中文 ApiException（标记 network，便于界面进入服务不可用页 / 重试） */
fun networkErrorOf(e: Throwable): ApiException = when (e) {
    is UnknownHostException -> ApiException(0, "网络连接失败，请检查网络后重试", null, network = true)
    is SocketTimeoutException -> ApiException(0, "连接超时，请检查网络后重试", null, network = true)
    is IOException -> ApiException(0, "网络连接失败，请检查网络后重试", null, network = true)
    else -> (e as? ApiException) ?: ApiException(0, e.message ?: "服务暂时不可用，请稍后再试")
}

/** 从 data 字段提取原始 JSON 字符串（就医提示等；调用方按需解析） */
private fun extractData(data: Any?): String? = when (data) {
    null -> null
    is JsonElement -> data.toString()
    else -> data.toString()
}
