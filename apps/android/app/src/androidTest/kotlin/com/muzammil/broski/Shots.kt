package com.muzammil.broski

import android.os.ParcelFileDescriptor
import androidx.test.platform.app.InstrumentationRegistry

/**
 * Screenshots of the whole screen (system bars and the notification shade included), taken by the
 * shell into /sdcard/broski-shots, which outlives the app's uninstall at the end of a run and which
 * scripts/test-android-real-machine.sh pulls.
 */
object Shots {
    private const val FOLDER = "/sdcard/broski-shots"
    private const val SETTLE_MS = 1_500L

    fun save(name: String) {
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        shell("mkdir -p $FOLDER")
        shell("screencap -p $FOLDER/$name.png")
    }

    /** The notification shade pulled down, saved, and put away again. */
    fun shade(name: String) {
        shell("cmd statusbar expand-notifications")
        Thread.sleep(SETTLE_MS)
        save(name)
        shell("cmd statusbar collapse")
        Thread.sleep(SETTLE_MS)
    }

    /** Runs a shell command and waits for it to finish. */
    fun shell(command: String) {
        val output = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        ParcelFileDescriptor.AutoCloseInputStream(output).use { it.readBytes() }
    }
}
