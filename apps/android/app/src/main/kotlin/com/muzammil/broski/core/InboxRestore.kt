package com.muzammil.broski.core

import android.util.Log
import com.muzammil.broski.core.vault.Vault
import java.io.IOException
import uniffi.broski_core.ClientException
import uniffi.broski_core.Inbox

private const val TAG = "InboxRestore"

/**
 * The seen state and the last known rows go back into [inbox] before any machine starts, as the
 * core requires. Either one that cannot be read is left out; a cache the core refuses (another
 * version's) is left for its next one to replace.
 */
internal suspend fun Vault.restoreInbox(inbox: Inbox) {
    try {
        seen()?.let(inbox::restoreSeen)
    } catch (error: IOException) {
        Log.w(TAG, "the inbox starts without its seen state", error)
    }
    try {
        inboxCache()?.let(inbox::restoreCache)
    } catch (error: IOException) {
        Log.w(TAG, "the inbox starts without its cached rows", error)
    } catch (error: ClientException) {
        Log.w(TAG, "the core refused the cached inbox", error)
    }
}
