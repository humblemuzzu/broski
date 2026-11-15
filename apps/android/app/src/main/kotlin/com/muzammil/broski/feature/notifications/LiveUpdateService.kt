package com.muzammil.broski.feature.notifications

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat

/**
 * Keeps the app's process running while agents work and the app is off screen, so its links stay
 * up and the Live Update stays true: a foreground service of type `connectedDevice` (the Mac is the
 * device, over the network), showing the Live Update itself as its notification.
 */
class LiveUpdateService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = LiveUpdate.current
        if (notification == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
        ServiceCompat.startForeground(this, LiveUpdate.ID, notification, type)
        running = true
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    companion object {
        @Volatile
        var running = false
            private set
    }
}
