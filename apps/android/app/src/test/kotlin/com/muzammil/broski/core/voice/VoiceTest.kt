package com.muzammil.broski.core.voice

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.muzammil.broski.core.settings.SettingsStore
import com.muzammil.broski.core.settings.VoiceSettings
import com.muzammil.broski.core.vault.AesGcmCipher
import com.muzammil.broski.core.vault.Vault
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
import java.net.UnknownHostException
import java.net.SocketTimeoutException
import javax.crypto.KeyGenerator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import uniffi.broski_core.DictationException
import uniffi.broski_core.dictationKeyCheck
import uniffi.broski_core.dictationRequest

/**
 * Dictation's Android side over the real core: the upload goes out exactly as the core built it, xAI's
 * answers become what the person sees, and the key and the settings survive a new store.
 */
class VoiceTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val scopes = mutableListOf<CoroutineScope>()
    private var server: HttpServer? = null

    @After
    fun stop() {
        server?.stop(0)
        scopes.forEach { it.cancel() }
    }

    /** A local server answering every request with [status] and [body], keeping what it received. */
    private fun serve(status: Int, body: String, received: MutableList<Pair<Map<String, String>, ByteArray>>): String {
        val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        http.createContext("/v1/stt") { exchange ->
            val headers = exchange.requestHeaders.mapValues { it.value.joinToString(",") }.mapKeys { it.key.lowercase() }
            received += headers to exchange.requestBody.readBytes()
            val bytes = body.encodeToByteArray()
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        http.start()
        server = http
        return "http://127.0.0.1:${http.address.port}/v1/stt"
    }

    @Test
    fun anUploadGoesOutAsTheCoreBuiltItAndItsTranscriptComesBack() = runBlocking {
        val received = mutableListOf<Pair<Map<String, String>, ByteArray>>()
        val url = serve(200, """{"text":"Rename isLoading in SessionView.kt","language":"en","duration":2.5,"words":[]}""", received)
        val request = dictationRequest("xai-test", "recorded speech".encodeToByteArray(), "dictation.m4a", "audio/mp4", "en", listOf("isLoading"))

        val transcription = GrokTranscriber.send(request.copy(url = url))

        assertEquals("Rename isLoading in SessionView.kt", transcription.text)
        assertEquals(2.5, transcription.durationSeconds, 0.0)
        val (headers, body) = received.single()
        assertArrayEquals(request.body, body)
        assertEquals("Bearer xai-test", headers["authorization"])
        assertTrue(headers["content-type"].orEmpty().startsWith("multipart/form-data; boundary="))
        assertTrue(body.decodeToString().contains("name=\"keyterm\"\r\n\r\nisLoading"))
    }

    @Test
    fun aRefusedKeyAsksForVoiceSettings() = runBlocking {
        val url = serve(400, """{"code":"Client specified an invalid argument","error":"Incorrect API key provided."}""", mutableListOf())
        try {
            GrokTranscriber.send(dictationKeyCheck("xai-wrong").copy(url = url))
            fail("a refused key is an error")
        } catch (error: DictationException.InvalidKey) {
            val problem = DictationProblem.of(error)
            assertEquals(DictationProblem.Fix.VoiceSettings, problem.fix)
            assertEquals("Incorrect API key provided.", problem.detail)
        }
    }

    @Test
    fun failuresSayWhetherTheRecordingCanGoAgain() {
        assertEquals(DictationProblem.Fix.Retry, DictationProblem.of(DictationException.RateLimited("")).fix)
        assertEquals(DictationProblem.Fix.Retry, DictationProblem.of(DictationException.Unavailable(503u, "down")).fix)
        assertEquals(DictationProblem.Fix.None, DictationProblem.of(DictationException.TooLarge()).fix)
        assertEquals(DictationProblem.Fix.None, DictationProblem.of(DictationException.Rejected("Failed to decode audio")).fix)
        assertEquals(DictationProblem.Fix.Retry, DictationProblem.of(UnknownHostException("api.x.ai")).fix)
        assertEquals(DictationProblem.Fix.Retry, DictationProblem.of(SocketTimeoutException()).fix)
    }

    @Test
    fun dictatedTextJoinsTheDraftWithOneSpace() {
        assertEquals("run bun test", DictationState.joined("", "run bun test"))
        assertEquals("Then run bun test", DictationState.joined("Then", "run bun test"))
        assertEquals("Then\nrun bun test", DictationState.joined("Then\n", "run bun test"))
    }

    @Test
    fun theKeyIsSealedAndTheSettingsKeptAcrossANewStore() = runBlocking {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val vaultFile = File(folder.root, "vault.preferences_pb")
        val settingsFile = File(folder.root, "settings.preferences_pb")
        fun scope() = CoroutineScope(SupervisorJob() + Dispatchers.IO).also(scopes::add)

        val vault = Vault(PreferenceDataStoreFactory.create(scope = scope(), produceFile = { vaultFile }), AesGcmCipher { key })
        assertNull(vault.xaiKey())
        vault.saveXaiKey("  xai-secret\n")
        assertTrue(!vaultFile.readBytes().decodeToString().contains("xai-secret"))
        assertEquals("xai-secret", vault.xaiKey())
        vault.deleteXaiKey()
        assertNull(vault.xaiKey())

        val store = SettingsStore(PreferenceDataStoreFactory.create(scope = scope(), produceFile = { settingsFile }))
        assertEquals(VoiceSettings(), store.settings.first().voice)
        store.setVoiceLanguage(null)
        store.setSendAfterDictating(true)
        store.setProjectWords(false)
        store.setDictionary(listOf("Broski", "Ghostty"))
        assertEquals(VoiceSettings(language = null, sendAfterDictating = true, projectWords = false, dictionary = listOf("Broski", "Ghostty")), store.settings.first().voice)
    }
}
