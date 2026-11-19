package com.muzammil.broski.core.usage

import android.content.Context
import android.util.Log
import java.io.File
import java.io.IOException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Persists the last [UsageReport] as JSON in app-private storage so both the Usage screen and the
 * Home Screen widget can read it synchronously on launch or widget update.
 */
class UsageStore(private val file: File) {
    constructor(context: Context) : this(File(context.applicationContext.filesDir, FILE_NAME))

    fun load(): UsageReport? {
        if (!file.exists()) return null
        return try {
            codec.decodeFromString<UsageReport>(file.readText())
        } catch (error: IOException) {
            Log.w(TAG, "could not read usage report", error)
            null
        } catch (error: SerializationException) {
            Log.w(TAG, "stored usage report was malformed", error)
            null
        }
    }

    fun save(report: UsageReport) {
        try {
            file.parentFile?.mkdirs()
            val temp = File(file.parentFile, "$FILE_NAME.tmp")
            temp.writeText(codec.encodeToString(report))
            if (!temp.renameTo(file)) {
                file.writeText(temp.readText())
                temp.delete()
            }
        } catch (error: IOException) {
            Log.w(TAG, "could not save usage report", error)
        }
    }

    companion object {
        private const val TAG = "UsageStore"
        private const val FILE_NAME = "usage_report.json"
        private val codec = Json { ignoreUnknownKeys = true }
    }
}
