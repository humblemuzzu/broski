package com.muzammil.broski.core.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
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
    val reading: ReadingSettings = ReadingSettings(),
)

/** Settings › Reading: text size steps on top of the system's, compact spacing, code that wraps, underlined links. */
data class ReadingSettings(
    val sizeSteps: Int = 0,
    val compact: Boolean = false,
    val wrapsCode: Boolean = false,
    val underlinesLinks: Boolean = false,
) {
    companion object {
        val SIZE_STEPS = -2..3
    }
}

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
            reading = reading(preferences),
        )
    }

    suspend fun setAppearance(appearance: Appearance) {
        store.edit { it[APPEARANCE] = appearance.name }
    }

    suspend fun setNotification(kind: NotificationKind, enabled: Boolean) {
        store.edit { it[notifyKey(kind)] = enabled }
    }

    suspend fun setReading(reading: ReadingSettings) {
        store.edit {
            it[READING_SIZE] = reading.sizeSteps.coerceIn(ReadingSettings.SIZE_STEPS)
            it[READING_COMPACT] = reading.compact
            it[READING_WRAPS_CODE] = reading.wrapsCode
            it[READING_UNDERLINES_LINKS] = reading.underlinesLinks
        }
    }

    private companion object {
        val READING_SIZE = intPreferencesKey("reading.size")
        val READING_COMPACT = booleanPreferencesKey("reading.compact")
        val READING_WRAPS_CODE = booleanPreferencesKey("reading.wrapsCode")
        val READING_UNDERLINES_LINKS = booleanPreferencesKey("reading.underlinesLinks")

        fun reading(preferences: Preferences) = ReadingSettings(
            sizeSteps = (preferences[READING_SIZE] ?: 0).coerceIn(ReadingSettings.SIZE_STEPS),
            compact = preferences[READING_COMPACT] ?: false,
            wrapsCode = preferences[READING_WRAPS_CODE] ?: false,
            underlinesLinks = preferences[READING_UNDERLINES_LINKS] ?: false,
        )

        val APPEARANCE = stringPreferencesKey("appearance")

        fun notifyKey(kind: NotificationKind) = booleanPreferencesKey("notify.${kind.name}")
    }
}
