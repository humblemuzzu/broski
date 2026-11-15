package com.muzammil.broski.app

import android.app.Application
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.feature.notifications.Notifications

class BroskiApplication : Application() {
    lateinit var core: AppCore
        private set
    lateinit var notifications: Notifications
        private set

    /** A session a notification asked to open, until the shell can show it. */
    val openRequests = OpenRequests()

    override fun onCreate() {
        super.onCreate()
        core = AppCore(this)
        notifications = Notifications(this, core).also { it.start() }
    }
}
