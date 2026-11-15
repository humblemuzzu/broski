package com.muzammil.broski

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import com.muzammil.broski.app.BroskiApplication
import com.muzammil.broski.core.CoreState
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.feature.notifications.wire
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assume.assumeTrue
import uniffi.broski_contract.BackendId
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.NewSessionOptions
import uniffi.broski_contract.NewSessionResult
import uniffi.broski_contract.PromptInput
import uniffi.broski_contract.PromptMode
import uniffi.broski_contract.PromptRequest
import uniffi.broski_contract.ServerMessage
import uniffi.broski_contract.SessionCreateRequest
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.SessionUpdate
import uniffi.broski_core.SessionView

/**
 * The machine scripts/test-android-real-machine.sh started: its offer, the folder its bridge serves
 * (a git repository with a change and an untracked file), and the channel to its stdin commands.
 */
class RealMachine private constructor(val offer: String, val root: String, private val control: String) {
    val context: Context = InstrumentationRegistry.getInstrumentation().targetContext

    val phone: PhoneSession
        get() = ((context.applicationContext as BroskiApplication).core.state.value as CoreState.Ready).session

    /** The one machine the first test paired. */
    val machineId: String
        get() = requireNotNull(phone.machines.value.singleOrNull()) { "the machine is paired by the first test" }.id

    /** A session with one finished exchange in the served folder (test-machine's `seed`). */
    fun seed(title: String): SessionRef {
        val answer = command(buildJsonObject { put("seed", title) })
        return session(requireNotNull(answer["seeded"]?.jsonObject) { "seeded: $answer" })
    }

    /** The session's next run streams, then holds until released or stopped (test-machine's `script`). */
    fun scriptHold(session: SessionRef) {
        command(buildJsonObject {
            put("script", wire(session))
            put("scenario", "hold")
        })
    }

    /** A terminal runs the session through the scenario "permission": it waits on a permission to run bash, which no phone prompted (test-machine's `run`). */
    fun runAsTerminalWithPermission(session: SessionRef) {
        val answer = command(buildJsonObject {
            put("run", wire(session))
            put("scenario", "permission")
        })
        check(answer["running"] != null) { "running: $answer" }
    }

    /** A new Pi session in the served folder, through the app's own `Machine`. */
    suspend fun newSession(): SessionRef {
        val machine = requireNotNull(phone.machine(machineId))
        val options = NewSessionOptions(cwd = root, modelId = null, thinking = null, modes = null)
        val created = machine.request(ClientMessage.SessionCreate(SessionCreateRequest("", BackendId.PI, options))) as ServerMessage.SessionCreateResult
        return (created.v1.result as NewSessionResult.Accepted).v1.session
    }

    /** Prompts `session` through the app's own `Machine`, with a view on it as the bridge takes a prompt only for a viewed session. */
    suspend fun prompt(session: SessionRef, text: String): SessionView {
        val machine = requireNotNull(phone.machine(machineId))
        val view = machine.attach(session)
        check(view.nextUpdate() is SessionUpdate.Reset) { "the view starts from a snapshot" }
        val input = PromptInput(UUID.randomUUID().toString(), PromptMode.START, text, emptyList(), null)
        machine.request(ClientMessage.Prompt(PromptRequest("", session, input)))
        return view
    }

    private fun command(body: JsonObject): JsonObject {
        val connection = URL(control).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            return Json.parseToJsonElement(connection.inputStream.use { it.readBytes().decodeToString() }).jsonObject
        } finally {
            connection.disconnect()
        }
    }

    private fun wire(session: SessionRef) = buildJsonObject {
        put("backend", session.backend.wire)
        put("sessionId", session.sessionId)
    }

    private fun session(json: JsonObject): SessionRef {
        val backend = json.getValue("backend").jsonPrimitive.content
        return SessionRef(BackendId.entries.first { it.wire == backend }, json.getValue("sessionId").jsonPrimitive.content)
    }

    companion object {
        /** The machine the instrumentation arguments name; the test is skipped without them. */
        fun fromArguments(): RealMachine {
            val arguments = InstrumentationRegistry.getArguments()
            val offer = arguments.getString("offer")
            val root = arguments.getString("root")
            val control = arguments.getString("control")
            assumeTrue("needs -e offer, -e root and -e control from scripts/test-android-real-machine.sh", offer != null && root != null && control != null)
            return RealMachine(offer!!, root!!, control!!)
        }
    }
}
