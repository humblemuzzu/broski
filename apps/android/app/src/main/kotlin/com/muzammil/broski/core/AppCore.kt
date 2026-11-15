package com.muzammil.broski.core

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.muzammil.broski.BuildConfig
import com.muzammil.broski.core.platform.LanDiscovery
import com.muzammil.broski.core.platform.NetworkWatcher
import com.muzammil.broski.core.settings.AppSettings
import com.muzammil.broski.core.settings.SettingsStore
import com.muzammil.broski.core.vault.AesGcmCipher
import com.muzammil.broski.core.vault.KeystoreKey
import com.muzammil.broski.core.vault.UnreadableSecretException
import com.muzammil.broski.core.vault.Vault
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.broski_core.ClientException
import uniffi.broski_core.Machine
import uniffi.broski_core.MachineRecord
import uniffi.broski_core.Phone
import uniffi.broski_core.PhoneConfig
import uniffi.broski_core.Platform

sealed interface CoreState {
    data object Starting : CoreState

    data class Ready(val session: PhoneSession) : CoreState

    data class Failed(val failure: StartupFailure) : CoreState
}

enum class StartupFailure {
    /** Pairings are stored, but the identity they belong to is not. */
    IdentityMissing,

    /** The identity secret is stored but does not open (the Keystore key is gone or the value damaged). */
    IdentityUnreadable,

    /** The core refused the stored identity, or could not make a first one. */
    IdentityRefused,

    /** The app's own storage could not be read. */
    StorageUnreadable;

    /** Whether the identity itself is what is lost or damaged, which only starting over can end. */
    val canStartOver: Boolean get() = this != StorageUnreadable
}

/**
 * Everything the app keeps for the life of the process, created once by the Application: the
 * vault, the settings, and the one [Phone], started off the main thread from the stored identity
 * (made on the first run only, never in place of one that is missing or fails to open).
 */
class AppCore(private val context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val vaultKey by lazy { KeystoreKey.obtain() }

    val vault = Vault(
        PreferenceDataStoreFactory.create(produceFile = { context.preferencesDataStoreFile("vault") }),
        AesGcmCipher { vaultKey },
    )

    val settingsStore = SettingsStore(
        PreferenceDataStoreFactory.create(produceFile = { context.preferencesDataStoreFile("settings") }),
    )

    /** `null` until the stored settings are read, so the first frame already has the right theme. */
    val settings: StateFlow<AppSettings?> = settingsStore.settings.stateIn(scope, SharingStarted.Eagerly, null)

    private val mutableState = MutableStateFlow<CoreState>(CoreState.Starting)
    val state: StateFlow<CoreState> = mutableState.asStateFlow()

    private val foreground = MutableStateFlow(false)
    private val held = MutableStateFlow(false)

    /**
     * Keeps every link up while the app is in the background, as the Live Update does while agents
     * work; without a hold the phone pauses its links when the app leaves the screen.
     */
    fun holdConnected(hold: Boolean) {
        held.value = hold
    }

    init {
        scope.launch(Dispatchers.IO) { mutableState.value = start() }
    }

    /**
     * Forgets this phone's identity and every pairing, then starts over with a new identity. Offered
     * only when the identity cannot be used, and only on the person's word.
     */
    fun startOver() {
        val failed = mutableState.value as? CoreState.Failed ?: return
        if (!mutableState.compareAndSet(failed, CoreState.Starting)) return
        scope.launch(Dispatchers.IO) {
            try {
                vault.clear()
            } catch (error: IOException) {
                Log.e(TAG, "the vault could not be cleared", error)
                mutableState.value = CoreState.Failed(StartupFailure.StorageUnreadable)
                return@launch
            }
            mutableState.value = start()
        }
    }

    private suspend fun start(): CoreState {
        val phone = try {
            openPhone()
        } catch (error: MissingIdentityException) {
            Log.e(TAG, "the identity is gone but pairings are stored", error)
            return CoreState.Failed(StartupFailure.IdentityMissing)
        } catch (error: UnreadableSecretException) {
            Log.e(TAG, "the identity secret does not open", error)
            return CoreState.Failed(StartupFailure.IdentityUnreadable)
        } catch (error: IOException) {
            Log.e(TAG, "the vault could not be read", error)
            return CoreState.Failed(StartupFailure.StorageUnreadable)
        } catch (error: ClientException) {
            Log.e(TAG, "the core refused the identity", error)
            return CoreState.Failed(StartupFailure.IdentityRefused)
        }
        val seen = try {
            vault.seen()
        } catch (error: IOException) {
            Log.w(TAG, "the inbox starts without its seen state", error)
            null
        }
        seen?.let { state -> phone.inbox().use { it.restoreSeen(state) } }
        val stored = try {
            vault.records()
        } catch (error: IOException) {
            Log.e(TAG, "the stored pairings could not be read", error)
            return CoreState.Failed(StartupFailure.StorageUnreadable)
        }
        val unreadable = stored.unreadable.toMutableSet()
        val machines = mutableListOf<Machine>()
        for ((id, bytes) in stored.readable) {
            try {
                machines += MachineRecord.fromBytes(bytes).use(phone::start)
            } catch (error: ClientException) {
                Log.e(TAG, "the stored record of $id does not decode", error)
                unreadable += id
            }
        }
        val session = PhoneSession(phone, vault, scope, machines, unreadable)
        withContext(Dispatchers.Main) { attachPlatform(session) }
        return CoreState.Ready(session)
    }

    private suspend fun openPhone(): Phone {
        val identity = launchIdentity(vault)
        return try {
            Phone(identity, phoneConfig())
        } finally {
            identity.fill(0)
        }
    }

    private fun phoneConfig() = PhoneConfig(
        deviceName = Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
            ?: "${Build.MANUFACTURER} ${Build.MODEL}",
        platform = Platform.ANDROID,
        clientName = "Broski for Android",
        clientVersion = BuildConfig.VERSION_NAME,
    )

    /** Foreground, network and LAN browse, for the life of the process. Runs on the main thread. */
    private fun attachPlatform(session: PhoneSession) {
        val discovery = LanDiscovery(context, session::lanDiscovered)
        NetworkWatcher(context, session::networkChanged).start()
        val lifecycle = ProcessLifecycleOwner.get().lifecycle
        foreground.value = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                foreground.value = true
                discovery.start()
            }

            override fun onStop(owner: LifecycleOwner) {
                foreground.value = false
                discovery.stop()
            }
        })
        scope.launch {
            combine(foreground, held) { shown, hold -> shown || hold }.distinctUntilChanged().collect { connected ->
                if (connected) session.resume() else session.pause()
            }
        }
    }

    private companion object {
        const val TAG = "AppCore"
    }
}
