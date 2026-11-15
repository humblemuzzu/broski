package com.muzammil.broski

import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.FrameMetrics
import android.view.Window
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import com.muzammil.broski.feature.chat.SessionClient
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertTrue
import uniffi.broski_contract.PromptInput
import uniffi.broski_contract.PromptMode
import uniffi.broski_core.SessionUpdate

/**
 * Scrolling a long transcript: [RUNS] runs of the `work` scenario (each a prompt, a notice, a
 * compaction, 24 paragraphs and a boundary: about a thousand transcript items), read from the
 * top of the newest page to the first message and back, with every frame the window draws
 * measured by the platform's FrameMetrics: the whole frame, and the main thread's part of it
 * (input, animation, measure and layout, recording the draw), which is the app's own; the rest is
 * the render thread and the GPU, which on an emulator is the host's translation of it.
 */
@OptIn(ExperimentalTestApi::class)
class ScrollFlow(private val ui: WorkspaceUiDriver, private val machine: RealMachine) {
    private val frames = mutableListOf<Long>()
    private val mainThread = mutableListOf<Long>()
    private val gpu = mutableListOf<Long>()

    fun run() {
        val title = "A thousand items"
        val session = machine.seed(title)
        runBlocking { playRuns(session) }
        ui.tap(hasContentDescription(title, substring = true) and hasClickAction())
        ui.waitFor(hasSetTextAction())
        ui.waitFor(hasText("Paragraph 24", substring = true))
        val window = ui.compose.activity.window
        measure(window) {
            var flings = 0
            while (ui.compose.onAllNodes(hasText("Hello")).fetchSemanticsNodes().isEmpty()) {
                check(flings++ < MAX_FLINGS) { "the first message was not reached" }
                fling(up = true)
            }
            repeat(flings) { fling(up = false) }
        }
        Log.i(TAG, "${frames.size} frames. Whole frame: ${summary(frames)}. Main thread: ${summary(mainThread)}. GPU: ${summary(gpu)}")
        assertTrue("frames were measured", frames.size > 100)
        ui.back()
    }

    private suspend fun playRuns(session: uniffi.broski_contract.SessionRef) {
        val phoneMachine = requireNotNull(machine.phone.machine(machine.machineId))
        val view = phoneMachine.attach(session)
        try {
            check(view.nextUpdate() is SessionUpdate.Reset)
            val client = SessionClient(phoneMachine) { session }
            repeat(RUNS) { run ->
                machine.script(session, "work")
                client.prompt(PromptInput(UUID.randomUUID().toString(), PromptMode.START, "Run ${run + 1}", emptyList(), null))
                withTimeout(30_000) {
                    while (true) {
                        val update = view.nextUpdate()
                        if (update is SessionUpdate.Changes && view.snapshot()?.run == null && update.changes.isNotEmpty()) break
                    }
                }
            }
        } finally {
            view.detach()
            view.close()
        }
    }

    /** A quick flick in the middle of the transcript, toward older messages or back. */
    private fun fling(up: Boolean) {
        ui.compose.onAllNodes(isRoot())[0].performTouchInput {
            val top = Offset(centerX, height * 0.3f)
            val bottom = Offset(centerX, height * 0.65f)
            swipe(if (up) top else bottom, if (up) bottom else top, durationMillis = 80)
        }
        ui.compose.waitForIdle()
    }

    private fun measure(window: Window, scroll: () -> Unit) {
        val thread = HandlerThread("frames").apply { start() }
        val listener = Window.OnFrameMetricsAvailableListener { _, metrics, _ ->
            if (metrics.getMetric(FrameMetrics.FIRST_DRAW_FRAME) == 0L) {
                synchronized(frames) {
                    frames += metrics.getMetric(FrameMetrics.TOTAL_DURATION)
                    mainThread += MAIN_THREAD.sumOf { metrics.getMetric(it) }
                    gpu += metrics.getMetric(FrameMetrics.GPU_DURATION)
                }
            }
        }
        ui.compose.runOnUiThread { window.addOnFrameMetricsAvailableListener(listener, Handler(thread.looper)) }
        try {
            scroll()
        } finally {
            ui.compose.runOnUiThread { window.removeOnFrameMetricsAvailableListener(listener) }
            thread.quitSafely()
        }
    }

    private fun summary(durations: List<Long>): String {
        val sorted = durations.sorted()
        fun ms(quantile: Double) = "%.1f".format(sorted[((sorted.size - 1) * quantile).toInt()] / 1e6)
        val over = durations.count { it > FRAME_BUDGET_NS }
        return "p50 ${ms(0.5)} ms, p90 ${ms(0.9)} ms, p99 ${ms(0.99)} ms, over 16.7 ms ${"%.1f".format(100.0 * over / durations.size)} %"
    }

    private companion object {
        const val TAG = "ScrollFlow"
        const val RUNS = 36
        const val MAX_FLINGS = 300
        const val FRAME_BUDGET_NS = 16_700_000L
        val MAIN_THREAD = listOf(
            FrameMetrics.INPUT_HANDLING_DURATION,
            FrameMetrics.ANIMATION_DURATION,
            FrameMetrics.LAYOUT_MEASURE_DURATION,
            FrameMetrics.DRAW_DURATION,
        )
    }
}
