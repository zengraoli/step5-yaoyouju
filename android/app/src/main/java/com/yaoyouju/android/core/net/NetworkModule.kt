package com.yaoyouju.android.core.net

import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

import com.yaoyouju.android.BuildConfig

/**
 * 网络层单例：Retrofit + OkHttp + kotlinx.serialization。
 * 基地址来自 BuildConfig.API_BASE_URL（默认 http://127.0.0.1:3200，
 * 真机调试用 adb reverse tcp:3200 tcp:3200）。
 */
object NetworkModule {

    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    private val logging by lazy {
        HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
            // 不打印 Authorization 头，避免令牌进入日志
            redactHeader("Authorization")
        }
    }

    /** 统一注入登录令牌（验收反馈第 18 条：请求必须带 Authorization） */
    private val authInterceptor = Interceptor { chain ->
        val original = chain.request()
        val builder = original.newBuilder()
        if (original.header("Authorization") == null) {
            TokenProvider.bearer()?.let { builder.header("Authorization", it) }
        }
        chain.proceed(builder.build())
    }

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .build()
    }

    /**
     * 测试专用基地址：把基地址换成本机肯定不会监听的端口，
     * 让截图测试不依赖「电脑上是否正好跑着 server」（第七轮验收反馈第 26 条）。
     */
    @Volatile
    private var testBaseUrl: String? = null

    fun useUnreachableBaseUrlForTests() {
        testBaseUrl = "http://127.0.0.1:1/"
    }

    val retrofit: Retrofit by lazy {
        Retrofit.Builder()
            .baseUrl((testBaseUrl ?: BuildConfig.API_BASE_URL).trimEnd('/') + "/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
    }

    inline fun <reified T> api(): T = retrofit.create(T::class.java)
}
