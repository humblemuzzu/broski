package com.muzammil.broski.core.voice

import android.content.Context
import android.util.Log
import com.muzammil.broski.R
import com.muzammil.broski.core.settings.AppSettings
import com.muzammil.broski.core.settings.VoiceSettings
import com.muzammil.broski.core.vault.Vault
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import uniffi.broski_core.DictationException
import uniffi.broski_core.DictationSources
import uniffi.broski_core.dictationTerms

/**
 * The app's one dictation, for whichever composer started it: hold the mic to talk and let go to
 * insert, or tap it to start and tap ✓ to insert. The recording goes to xAI with the session's names
 * and the person's own words; with no key the phone's recognizer stands in, from the composer.
 * Runs on the main thread; the upload and the names run off it.
 */
class Dictation(context: Context, private val vault: Vault, private val settings: StateFlow<AppSettings?>) {
    private val context = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val recorder = DictationRecorder(this.context)
    private val mutableState = MutableStateFlow(DictationState())
    private val mutableFeedback = MutableSharedFlow<DictationFeedback>(extraBufferCapacity = 8)
    private val mutableKey = MutableStateFlow<String?>(null)

    val state: StateFlow<DictationState> = mutableState.asStateFlow()
    val feedback: SharedFlow<DictationFeedback> = mutableFeedback.asSharedFlow()

    /** The saved xAI key; `null` while none is. */
    val key: StateFlow<String?> = mutableKey.asStateFlow()

    /**
     * The loudness now, 0 to 1, read every [METER_MS] while recording. Kept out of [state] so the
     * composer's voice glow samples it each frame without recomposing anything.
     */
    var level: Float = 0f
        private set
    val glance = WorkspaceGlance()

    private var target: DictationTarget? = null
    private var file: File? = null
    private var sources: Deferred<DictationSources>? = null
    private var metering: Job? = null
    private var work: Job? = null
    private var finishOnRelease = false
    private var notices = 0L

    init {
        DictationRecorder.removeLeftovers(this.context)
        recorder.onStoppedByItself = { scope.launch { finish() } }
        scope.launch {
            mutableKey.value = try {
                vault.xaiKey()
            } catch (error: IOException) {
                Log.e(TAG, "the xAI key could not be read", error)
                null
            }
        }
    }

    // The mic's gesture

    /** The finger went down on [target]'s mic, with the microphone already allowed. */
    fun press(target: DictationTarget): PressOutcome {
        finishOnRelease = false
        if (state.value.phase is DictationPhase.Failed && state.value.owner != target.id) discard()
        when (state.value.phaseFor(target.id)) {
            is DictationPhase.Recording -> {
                val held = (state.value.phase as DictationPhase.Recording).held
                if (!held) finishOnRelease = true
                return PressOutcome.Ignored
            }
            DictationPhase.Transcribing -> return PressOutcome.Ignored
            is DictationPhase.Failed -> discard()
            DictationPhase.Idle -> Unit
        }
        if (state.value.busyApartFrom(target.id)) return PressOutcome.Ignored
        if (key.value == null) return PressOutcome.NeedsPhoneRecognizer
        start(target)
        return PressOutcome.Started
    }

    /** The finger slid away from the mic far enough to cancel on release, or came back. */
    fun slide(cancelling: Boolean) {
        val recording = state.value.phase as? DictationPhase.Recording ?: return
        if (recording.held && recording.cancelling != cancelling) mutableState.update { it.copy(phase = recording.copy(cancelling = cancelling)) }
    }

    /** The finger lifted after [heldMs] on the mic. */
    fun release(heldMs: Long) {
        if (finishOnRelease) {
            finishOnRelease = false
            finish()
            return
        }
        val recording = state.value.phase as? DictationPhase.Recording ?: return
        when {
            !recording.held -> Unit
            recording.cancelling -> cancel()
            heldMs < TAP_MS -> mutableState.update { it.copy(phase = DictationPhase.Recording(held = false, cancelling = false)) }
            else -> finish()
        }
    }

    // Recording

    private fun start(target: DictationTarget) {
        val started = try {
            recorder.start()
        } catch (error: Exception) {
            Log.e(TAG, "the recording did not start", error)
            fail(DictationProblem(R.string.dictation_microphone_failed, error.message, DictationProblem.Fix.None), target.id)
            return
        }
        this.target = target
        file = started
        level = 0f
        mutableState.value = DictationState(
            owner = target.id,
            phase = DictationPhase.Recording(held = true, cancelling = false),
            startedAtMs = System.currentTimeMillis(),
        )
        play(DictationFeedback.Moment.Listening, target.id)
        sources = scope.async { target.sources() }
        metering = scope.launch {
            while (state.value.phase is DictationPhase.Recording) {
                level = recorder.level()
                delay(METER_MS)
            }
            level = 0f
        }
    }

    /** Stops the recording and transcribes it; a slip shorter than [SHORTEST_MS] is dropped. */
    fun finish() {
        val owner = state.value.owner ?: return
        if (state.value.phase !is DictationPhase.Recording) return
        metering?.cancel()
        val elapsed = System.currentTimeMillis() - (state.value.startedAtMs ?: 0L)
        val recorded = recorder.stop()
        file = recorded
        if (recorded == null || elapsed < SHORTEST_MS) {
            discard()
            show(DictationNotice.Kind.TooShort, owner)
            return
        }
        play(DictationFeedback.Moment.Stopped, owner)
        transcribe()
    }

    /** Stops whatever is under way and throws the recording away. */
    fun cancel() {
        val owner = state.value.owner ?: return
        if (state.value.phase is DictationPhase.Recording) recorder.cancel()
        work?.cancel()
        play(DictationFeedback.Moment.Cancelled, owner)
        discard()
    }

    fun retry() {
        val failed = state.value.phase as? DictationPhase.Failed ?: return
        if (failed.problem.fix == DictationProblem.Fix.Retry && file != null) transcribe()
    }

    /** Forgets a failed or finished dictation and its recording. */
    fun discard() {
        file?.delete()
        metering?.cancel()
        sources?.cancel()
        work = null
        target = null
        file = null
        finishOnRelease = false
        mutableState.update { DictationState(notice = it.notice) }
    }

    /** The composer [id] left the screen: its recording ends there and is transcribed into its draft. */
    fun composerLeft(id: String) {
        if (state.value.owner == id && state.value.phase is DictationPhase.Recording) finish()
    }

    /** The app left the screen, where the system stops the microphone: what was said is transcribed. */
    fun sceneLeft() {
        if (state.value.phase is DictationPhase.Recording) finish()
    }

    /** The microphone was refused for [owner]'s mic. */
    fun microphoneDenied(owner: String) = fail(DictationProblem.microphoneDenied, owner)

    fun microphoneAllowed(owner: String) = show(DictationNotice.Kind.MicrophoneReady, owner)

    /** Text the phone's own recognizer heard for [target]. */
    fun recognized(target: DictationTarget, text: String?) {
        if (text.isNullOrBlank()) {
            show(DictationNotice.Kind.HeardNothing, target.id)
            return
        }
        target.insert(text.trim())
        play(DictationFeedback.Moment.Inserted, target.id)
        show(DictationNotice.Kind.PhoneRecognizer, target.id)
    }

    /** The spoken language the person pinned; `null` to let it be detected. */
    fun language(): String? = (settings.value?.voice ?: VoiceSettings()).language

    /** The phone has no recognizer of its own and there is no key. */
    fun noRecognizer(owner: String) = show(DictationNotice.Kind.NoRecognizer, owner)

    private fun fail(problem: DictationProblem, owner: String) {
        if (problem.fix != DictationProblem.Fix.Retry) {
            file?.delete()
            file = null
        }
        mutableState.update { it.copy(owner = owner, phase = DictationPhase.Failed(problem)) }
        play(DictationFeedback.Moment.Failed, owner)
    }

    private fun show(kind: DictationNotice.Kind, owner: String) {
        val notice = DictationNotice(owner, kind, ++notices)
        mutableState.update { it.copy(notice = notice) }
        scope.launch {
            delay(NOTICE_MS)
            mutableState.update { if (it.notice == notice) it.copy(notice = null) else it }
        }
    }

    private fun play(moment: DictationFeedback.Moment, owner: String) {
        mutableFeedback.tryEmit(DictationFeedback(owner, moment))
    }

    // Transcribing

    private fun transcribe() {
        val target = target ?: return
        val recording = file ?: return
        val key = key.value ?: return fail(DictationProblem(R.string.dictation_no_key, fix = DictationProblem.Fix.VoiceSettings), target.id)
        val voice = settings.value?.voice ?: VoiceSettings()
        mutableState.update { it.copy(phase = DictationPhase.Transcribing) }
        work = scope.launch {
            val terms = terms(voice)
            val outcome = try {
                val audio = withContext(Dispatchers.IO) { recording.readBytes() }
                Result.success(GrokTranscriber.transcribe(audio, key, voice.language, terms).text)
            } catch (error: DictationException) {
                Result.failure(Failed(DictationProblem.of(error)))
            } catch (error: IOException) {
                Result.failure(Failed(DictationProblem.of(error)))
            }
            if (this@Dictation.target?.id != target.id) return@launch
            outcome.fold(
                onSuccess = { deliver(it, target, voice) },
                onFailure = { fail((it as Failed).problem, target.id) },
            )
        }
    }

    private class Failed(val problem: DictationProblem) : Exception()

    /** The session's names when the person wants them and the Mac answers in time, and their own words always. */
    private suspend fun terms(voice: VoiceSettings): List<String> {
        val gathered = sources.takeIf { voice.projectWords }?.let { names ->
            withTimeoutOrNull(SOURCES_MS) {
                try {
                    names.await()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    Log.i(TAG, "the session's names were not gathered", error)
                    null
                }
            }
        }
        val ready = (gathered ?: EMPTY).copy(dictionary = voice.dictionary)
        return withContext(Dispatchers.Default) { dictationTerms(ready) }
    }

    private fun deliver(text: String, target: DictationTarget, voice: VoiceSettings) {
        discard()
        if (text.isBlank()) {
            show(DictationNotice.Kind.HeardNothing, target.id)
            return
        }
        target.insert(text)
        play(DictationFeedback.Moment.Inserted, target.id)
        if (voice.sendAfterDictating) target.send?.invoke()
    }

    // The key

    /** Checks [entry] with xAI and keeps it when xAI takes it, or when xAI cannot be reached to say. */
    suspend fun saveKey(entry: String): KeyOutcome {
        val candidate = entry.trim()
        val outcome = try {
            GrokTranscriber.check(candidate)
            KeyOutcome.Checked
        } catch (error: DictationException) {
            return KeyOutcome.Refused(DictationProblem.of(error))
        } catch (error: IOException) {
            KeyOutcome.Unchecked(error.message)
        }
        return try {
            vault.saveXaiKey(candidate)
            mutableKey.value = candidate
            outcome
        } catch (error: IOException) {
            KeyOutcome.Refused(DictationProblem(R.string.voice_key_not_saved, error.message, DictationProblem.Fix.None))
        }
    }

    suspend fun removeKey() {
        vault.deleteXaiKey()
        mutableKey.value = null
    }

    sealed interface KeyOutcome {
        data object Checked : KeyOutcome

        /** Saved, but xAI could not be reached to check it. */
        data class Unchecked(val detail: String?) : KeyOutcome

        data class Refused(val problem: DictationProblem) : KeyOutcome
    }

    companion object {
        private const val TAG = "Dictation"

        /** A press shorter than this starts a recording that goes on without the finger. */
        const val TAP_MS = 350L

        /** A recording shorter than this is a slip, not speech. */
        const val SHORTEST_MS = 500L
        private const val METER_MS = 50L
        private const val NOTICE_MS = 5_000L
        private const val SOURCES_MS = 1_500L
        private val EMPTY = DictationSources(emptyList(), null, null, null, emptyList())
    }
}
