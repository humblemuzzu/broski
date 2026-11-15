package com.muzammil.broski.app

import android.app.Application
import com.muzammil.broski.core.AppCore

class BroskiApplication : Application() {
    lateinit var core: AppCore
        private set

    override fun onCreate() {
        super.onCreate()
        core = AppCore(this)
    }
}
