package com.muzammil.broski.feature.notifications

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import uniffi.broski_core.LetterRequest

/**
 * POSTs a sealed letter to the machine's relay exactly as the core built it: its URL, its headers
 * and its body bytes. Returns the relay's HTTP status.
 *
 * @throws IOException when the relay cannot be reached.
 */
fun postLetter(letter: LetterRequest): Int {
    val connection = URL(letter.url).openConnection() as HttpURLConnection
    try {
        connection.requestMethod = "POST"
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        connection.doOutput = true
        connection.setFixedLengthStreamingMode(letter.body.size)
        letter.headers.forEach { connection.setRequestProperty(it.name, it.value) }
        connection.outputStream.use { it.write(letter.body) }
        return connection.responseCode
    } finally {
        connection.disconnect()
    }
}

private const val TIMEOUT_MS = 15_000
