package com.yaoyouju.android.core.datastore

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "yaoyouju_prefs")

/** 本地持久化：登录令牌与接口基地址（不写入任何账号口令） */
class TokenStore(private val context: Context) {

    private val tokenKey = stringPreferencesKey("token")
    private val baseUrlKey = stringPreferencesKey("api_base_url")

    val token: Flow<String> = context.dataStore.data.map { it[tokenKey] ?: "" }

    val baseUrl: Flow<String> = context.dataStore.data.map { it[baseUrlKey] ?: "" }

    suspend fun saveToken(token: String) {
        context.dataStore.edit { prefs ->
            if (token.isBlank()) prefs.remove(tokenKey) else prefs[tokenKey] = token
        }
    }

    suspend fun saveBaseUrl(url: String) {
        context.dataStore.edit { prefs ->
            if (url.isBlank()) prefs.remove(baseUrlKey) else prefs[baseUrlKey] = url
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
