package com.muzammil.broski.core.voice

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.broski_core.HttpRequest
import uniffi.broski_core.Transcription
import uniffi.broski_core.dictationKeyCheck
import uniffi.broski_core.dictationRequest
import uniffi.broski_core.dictationResult

/**
 * Sends a recording to xAI exactly as the core built the request, and reads the answer with the
 * core: an [IOException] when no answer came, a `DictationException` when xAI said no.
 */
object GrokTranscriber {
    suspend fun transcribe(audio: ByteArray, key: String, language: String?, terms: List<String>): Transcription =
        send(dictationRequest(key, audio, "dictation.m4a", "audio/mp4", language, terms))

    /** Whether [key] can transcribe, by sending a quarter second of silence. */
    suspend fun check(key: String) {
        send(dictationKeyCheck(key))
    }

    suspend fun send(request: HttpRequest): Transcription = withContext(Dispatchers.IO) {
        val connection = URL(request.url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.doOutput = true
            connection.useCaches = false
            connection.setFixedLengthStreamingMode(request.body.size)
            request.headers.forEach { connection.setRequestProperty(it.name, it.value) }
            connection.outputStream.use { it.write(request.body) }
            val status = connection.responseCode
            val body = (if (status < 400) connection.inputStream else connection.errorStream)?.use { it.readBytes() } ?: ByteArray(0)
            dictationResult(status.toUShort(), body)
        } finally {
            connection.disconnect()
        }
    }

    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 60_000
}
