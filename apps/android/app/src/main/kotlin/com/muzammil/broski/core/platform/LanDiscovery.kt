package com.muzammil.broski.core.platform

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap

/**
 * Browses the LAN for the daemons' `_broski-link._tcp` advertisements
 * (`packages/link/daemon/src/discovery.rs`: TXT `id` is the machine id, `v` the protocol version) and
 * hands each machine's `host:port` routes to [onRoutes]. API 34+ resolves through
 * `registerServiceInfoCallback`, which follows a service's address changes; below it, one
 * `resolveService` at a time, as that API allows.
 */
class LanDiscovery(context: Context, private val onRoutes: (machineId: String, routes: List<String>) -> Unit) {
    private val nsd = context.getSystemService(NsdManager::class.java)
    private val resolver: Resolver = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        InfoCallbackResolver(nsd, ::resolved)
    } else {
        QueuedResolver(nsd, ::resolved)
    }
    private var discovery: NsdManager.DiscoveryListener? = null

    @Synchronized
    fun start() {
        if (discovery != null) return
        val listener = object : NsdManager.DiscoveryListener {
            override fun onServiceFound(info: NsdServiceInfo) = resolver.resolve(info)

            override fun onServiceLost(info: NsdServiceInfo) = resolver.forget(info)

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.w(TAG, "LAN discovery did not start: $errorCode")
                synchronized(this@LanDiscovery) { if (discovery === this) discovery = null }
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.w(TAG, "LAN discovery did not stop: $errorCode")
            }

            override fun onDiscoveryStarted(serviceType: String) = Unit

            override fun onDiscoveryStopped(serviceType: String) = Unit
        }
        discovery = listener
        nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    }

    @Synchronized
    fun stop() {
        discovery?.let(nsd::stopServiceDiscovery)
        discovery = null
        resolver.stopAll()
    }

    private fun resolved(info: NsdServiceInfo, addresses: List<InetAddress>) {
        val attributes = info.attributes
        val machineId = attributes[TXT_ID]?.decodeToString() ?: return
        if (attributes[TXT_VERSION]?.decodeToString() != VERSION) return
        val routes = lanRoutes(addresses, info.port)
        if (routes.isNotEmpty()) onRoutes(machineId, routes)
    }

    private interface Resolver {
        fun resolve(info: NsdServiceInfo)

        fun forget(info: NsdServiceInfo)

        fun stopAll()
    }

    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private class InfoCallbackResolver(
        private val nsd: NsdManager,
        private val resolved: (NsdServiceInfo, List<InetAddress>) -> Unit,
    ) : Resolver {
        private val callbacks = ConcurrentHashMap<String, NsdManager.ServiceInfoCallback>()

        override fun resolve(info: NsdServiceInfo) {
            val callback = object : NsdManager.ServiceInfoCallback {
                override fun onServiceUpdated(updated: NsdServiceInfo) = resolved(updated, updated.hostAddresses)

                override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
                    callbacks.remove(info.serviceName, this)
                }

                override fun onServiceLost() = Unit

                override fun onServiceInfoCallbackUnregistered() = Unit
            }
            if (callbacks.putIfAbsent(info.serviceName, callback) == null) {
                nsd.registerServiceInfoCallback(info, Runnable::run, callback)
            }
        }

        override fun forget(info: NsdServiceInfo) {
            callbacks.remove(info.serviceName)?.let(nsd::unregisterServiceInfoCallback)
        }

        override fun stopAll() {
            callbacks.keys.toList().forEach { name -> callbacks.remove(name)?.let(nsd::unregisterServiceInfoCallback) }
        }
    }

    /** `resolveService` and `NsdServiceInfo.host` are deprecated from API 34, where the class above serves. */
    @Suppress("DEPRECATION")
    private class QueuedResolver(
        private val nsd: NsdManager,
        private val resolved: (NsdServiceInfo, List<InetAddress>) -> Unit,
    ) : Resolver {
        private val pending = ArrayDeque<NsdServiceInfo>()
        private var busy = false

        @Synchronized
        override fun resolve(info: NsdServiceInfo) {
            if (pending.none { it.serviceName == info.serviceName }) pending.addLast(info)
            next()
        }

        @Synchronized
        override fun forget(info: NsdServiceInfo) {
            pending.removeAll { it.serviceName == info.serviceName }
        }

        @Synchronized
        override fun stopAll() = pending.clear()

        private fun next() {
            if (busy) return
            val info = pending.removeFirstOrNull() ?: return
            busy = true
            nsd.resolveService(info, object : NsdManager.ResolveListener {
                override fun onServiceResolved(service: NsdServiceInfo) {
                    resolved(service, listOfNotNull(service.host))
                    done()
                }

                override fun onResolveFailed(service: NsdServiceInfo, errorCode: Int) = done()
            })
        }

        @Synchronized
        private fun done() {
            busy = false
            next()
        }
    }

    private companion object {
        const val TAG = "LanDiscovery"
        const val SERVICE_TYPE = "_broski-link._tcp"
        const val TXT_ID = "id"
        const val TXT_VERSION = "v"
        const val VERSION = "1"
    }
}

/**
 * The `host:port` routes the link dials, IPv4 first. Link-local IPv6 is left out: it needs a zone,
 * which the link's URL parser (`session/src/endpoint.rs`) does not accept.
 */
internal fun lanRoutes(addresses: List<InetAddress>, port: Int): List<String> {
    val v4 = addresses.filterIsInstance<Inet4Address>().map { "${it.hostAddress}:$port" }
    val v6 = addresses.filterIsInstance<Inet6Address>()
        .filterNot { it.isLinkLocalAddress }
        .map { "[${it.hostAddress}]:$port" }
    return (v4 + v6).distinct()
}
