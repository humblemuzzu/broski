package com.muzammil.broski.core.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import java.io.File
import java.util.UUID

/**
 * The microphone, recorded to an AAC `.m4a` at 16 kHz mono and 32 kbit/s: what xAI's model takes
 * natively, about 4 KB a second, so a minute uploads in a blink even on a weak connection. Other
 * audio pauses while it records.
 */
class DictationRecorder(private val context: Context) {
    /** The recording stopped by itself: it reached [LONGEST_MS], or the recorder failed. */
    var onStoppedByItself: (() -> Unit)? = null

    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private val audio = context.getSystemService(AudioManager::class.java)
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .build()

    /**
     * Starts recording into a new file in the dictation folder.
     *
     * @throws java.io.IOException or [RuntimeException] when the microphone does not start.
     */
    fun start(): File {
        val target = File(folder(context), "${UUID.randomUUID()}.m4a")
        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        try {
            recorder.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioSamplingRate(SAMPLE_RATE)
            recorder.setAudioChannels(1)
            recorder.setAudioEncodingBitRate(BIT_RATE)
            recorder.setMaxDuration(LONGEST_MS)
            recorder.setOutputFile(target)
            recorder.setOnInfoListener { _, what, _ ->
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) onStoppedByItself?.invoke()
            }
            recorder.setOnErrorListener { _, _, _ -> onStoppedByItself?.invoke() }
            recorder.prepare()
            audio.requestAudioFocus(focus)
            recorder.start()
        } catch (error: Exception) {
            recorder.release()
            audio.abandonAudioFocusRequest(focus)
            target.delete()
            throw error
        }
        this.recorder = recorder
        file = target
        return target
    }

    /** The loudness since the last call, 0 for silence to 1 for shouting, on a curve that makes speech move. */
    fun level(): Float {
        val peak = recorder?.maxAmplitude ?: return 0f
        val linear = (peak / 32_767f).coerceIn(0f, 1f)
        return kotlin.math.sqrt(linear)
    }

    /** Stops and keeps the file; `null` when nothing was recording or nothing was captured. */
    fun stop(): File? {
        val recorder = recorder ?: return null
        val captured = try {
            recorder.stop()
            true
        } catch (_: RuntimeException) {
            false
        }
        end(recorder)
        val kept = file
        file = null
        if (!captured) kept?.delete()
        return kept.takeIf { captured }
    }

    /** Stops and deletes the file. */
    fun cancel() {
        val recorder = recorder ?: return
        try {
            recorder.stop()
        } catch (_: RuntimeException) {
        }
        end(recorder)
        file?.delete()
        file = null
    }

    private fun end(recorder: MediaRecorder) {
        recorder.setOnInfoListener(null)
        recorder.setOnErrorListener(null)
        recorder.release()
        this.recorder = null
        audio.abandonAudioFocusRequest(focus)
    }

    companion object {
        /** xAI takes 500 MB; ten minutes is a long prompt already, and 2.4 MB. */
        const val LONGEST_MS = 600_000
        private const val SAMPLE_RATE = 16_000
        private const val BIT_RATE = 32_000

        /** Where recordings wait until they are transcribed or thrown away; emptied at launch. */
        fun folder(context: Context): File = File(context.cacheDir, "dictation").apply { mkdirs() }

        fun removeLeftovers(context: Context) {
            folder(context).listFiles()?.forEach { it.delete() }
        }
    }
}
