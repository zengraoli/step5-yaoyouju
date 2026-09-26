package com.yaoyouju.android.core.net

import kotlinx.serialization.json.JsonElement
import retrofit2.Response

/**
 * 统一响应处理：HTTP 2xx 且 code = 0 → data；否则抛 ApiException（中文 message）。
 * 安全规则命中（40910/40911）的响应体 data 为就医提示内容，随异常透出。
 */
suspend fun <T> handleResponse(response: Response<ApiResponse<T>>): T {
    val body = response.body()
    if (response.isSuccessful && body != null && body.code == 0) {
        return body.data as T
    }
    val errorBody = body
    if (errorBody != null && errorBody.code != 0) {
        throw ApiException(errorBody.code, errorBody.message, extractData(errorBody.data))
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

/** 从 data 字段提取原始 JSON 字符串（就医提示等；调用方按需解析） */
private fun extractData(data: Any?): String? = when (data) {
    null -> null
    is JsonElement -> data.toString()
    else -> data.toString()
}
