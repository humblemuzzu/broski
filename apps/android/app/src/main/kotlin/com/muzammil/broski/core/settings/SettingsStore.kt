package com.muzammil.broski.core.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.emptyPreferences
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map

enum class Appearance { System, Light, Dark }

/** The kinds of notification the person can turn off; local preferences, never sent anywhere. */
enum class NotificationKind { NeedsYou, Done, Failures }

data class AppSettings(
    val appearance: Appearance = Appearance.System,
    val notifications: Set<NotificationKind> = NotificationKind.entries.toSet(),
)

/** The person's local preferences, unencrypted: nothing in them is secret. */
class SettingsStore(private val store: DataStore<Preferences>) {

    /** Unreadable settings are the defaults: nothing in them is worth refusing to start over. */
    val settings: Flow<AppSettings> = store.data.catch { error ->
        if (error !is IOException) throw error
        emit(emptyPreferences())
    }.map { preferences ->
        AppSettings(
            appearance = preferences[APPEARANCE]
                ?.let { stored -> Appearance.entries.firstOrNull { it.name == stored } }
                ?: Appearance.System,
            notifications = NotificationKind.entries.filterTo(mutableSetOf()) { preferences[notifyKey(it)] ?: true },
        )
    }

    suspend fun setAppearance(appearance: Appearance) {
        store.edit { it[APPEARANCE] = appearance.name }
    }

    suspend fun setNotification(kind: NotificationKind, enabled: Boolean) {
        store.edit { it[notifyKey(kind)] = enabled }
    }

    private companion object {
        val APPEARANCE = stringPreferencesKey("appearance")

        fun notifyKey(kind: NotificationKind) = booleanPreferencesKey("notify.${kind.name}")
    }
}
