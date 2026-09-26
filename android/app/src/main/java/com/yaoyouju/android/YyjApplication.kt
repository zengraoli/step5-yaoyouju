package com.yaoyouju.android

import android.app.Application
import com.yaoyouju.android.core.datastore.TokenStore

class YyjApplication : Application() {
    lateinit var tokenStore: TokenStore
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        tokenStore = TokenStore(this)
    }

    companion object {
        lateinit var instance: YyjApplication
            private set
    }
}
