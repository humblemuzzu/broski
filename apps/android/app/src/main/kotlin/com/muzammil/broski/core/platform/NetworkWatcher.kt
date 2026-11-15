package com.muzammil.broski.core.platform

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network

/**
 * Calls [onChange] when the default network becomes another one (Wi-Fi to mobile data, a new
 * Wi-Fi network, back after none), so the machines race their routes again at once instead of
 * waiting for a dead socket to time out. The first network seen at registration is not a change.
 */
class NetworkWatcher(context: Context, private val onChange: () -> Unit) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)

    private val callback = object : ConnectivityManager.NetworkCallback() {
        private var current: Network? = null
        private var seenAny = false

        override fun onAvailable(network: Network) {
            val changed = seenAny && network != current
            current = network
            seenAny = true
            if (changed) onChange()
        }

        override fun onLost(network: Network) {
            if (network == current) current = null
        }
    }

    fun start() = connectivity.registerDefaultNetworkCallback(callback)
}
