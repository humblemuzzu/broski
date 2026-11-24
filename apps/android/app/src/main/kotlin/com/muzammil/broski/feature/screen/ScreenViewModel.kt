package com.muzammil.broski.feature.screen

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.core.PhoneSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.broski_core.AuthScheme
import uniffi.broski_core.ScreenCloseReason
import uniffi.broski_core.ScreenCredentials
import uniffi.broski_core.ScreenShortcut
import uniffi.broski_core.ScreenUpdate
import uniffi.broski_core.ScreenView

enum class PointerMode { Trackpad, DirectTouch }

enum class ModifierKey(val glyph: String, val keysym: UInt) {
    Command("⌘", 0xffebU),
    Option("⌥", 0xffe9U),
    Control("⌃", 0xffe3U),
    Shift("⇧", 0xffe1U),
}

sealed interface ScreenPhase {
    data object Connecting : ScreenPhase
    data class AuthRequired(val schemes: List<AuthScheme>, val errorMessage: String? = null) : ScreenPhase
    data object Live : ScreenPhase
    data class Disabled(val detail: String) : ScreenPhase
    data class Closed(val detail: String) : ScreenPhase
}

data class ScreenUiState(
    val phase: ScreenPhase = ScreenPhase.Connecting,
    val desktopName: String = "",
    val frameWidth: Int = 0,
    val frameHeight: Int = 0,
    val frameBitmap: ImageBitmap? = null,
    val frameVersion: Long = 0L,
    val cursorBitmap: ImageBitmap? = null,
    val cursorHotspot: Offset = Offset.Zero,
    val cursorPos: Offset = Offset.Zero,
    val pointerMode: PointerMode = PointerMode.Trackpad,
    val activeModifiers: Set<ModifierKey> = emptySet(),
    val clipboardFromMac: String? = null,
    val savedUsername: String = "",
    val hasSavedCredentials: Boolean = false,
)

class ScreenViewModel(
    private val phone: PhoneSession,
    private val machineId: String,
) : ViewModel() {
    private val mutable = MutableStateFlow(ScreenUiState())
    val state: StateFlow<ScreenUiState> = mutable.asStateFlow()

    private var view: ScreenView? = null
    private var pumpJob: Job? = null
    private val frameBuffer = ScreenFrameBuffer()
    private var lastSchemes: List<AuthScheme> = listOf(AuthScheme.APPLE_CREDENTIALS, AuthScheme.VNC_PASSWORD)
    private var pendingCredentials: ScreenCredentials? = null
    private var rememberPending = true
    private var usingSavedCredentials = false

    init {
        connectSaved()
    }

    fun connectSaved() {
        viewModelScope.launch {
            val saved = phone.screenCredentials(machineId)
            val creds = saved?.let { (u, p) -> ScreenCredentials(username = u, password = p) }
            usingSavedCredentials = creds != null
            if (saved != null) {
                mutable.update { it.copy(savedUsername = saved.first, hasSavedCredentials = true) }
            }
            connect(creds, fromStore = creds != null)
        }
    }

    fun connect(credentials: ScreenCredentials? = null, fromStore: Boolean = false) {
        disconnect()
        val machine = phone.machine(machineId)
        if (machine == null) {
            mutable.update { it.copy(phase = ScreenPhase.Closed("Machine not connected")) }
            return
        }
        usingSavedCredentials = fromStore && credentials != null
        mutable.update { it.copy(phase = ScreenPhase.Connecting, activeModifiers = emptySet()) }
        try {
            val screenView = machine.openScreen(credentials)
            view = screenView
            pumpJob = viewModelScope.launch(Dispatchers.Default) {
                try {
                    while (true) {
                        val update = screenView.nextUpdate() ?: break
                        applyUpdate(update)
                        if (update is ScreenUpdate.Closed) break
                    }
                    mutable.update { current ->
                        if (current.phase == ScreenPhase.Live) {
                            current.copy(phase = ScreenPhase.Closed("Disconnected"))
                        } else {
                            current
                        }
                    }
                } finally {
                    withContext(Dispatchers.Main.immediate) {
                        if (view === screenView) view = null
                    }
                    screenView.close()
                }
            }
        } catch (error: Exception) {
            mutable.update { it.copy(phase = ScreenPhase.Closed(error.message ?: "Failed to open screen")) }
        }
    }

    fun submitCredentials(username: String, password: String, remember: Boolean) {
        val creds = ScreenCredentials(username = username, password = password)
        pendingCredentials = creds
        rememberPending = remember
        usingSavedCredentials = false
        mutable.update { it.copy(savedUsername = username) }
        val currentView = view
        if (currentView != null && mutable.value.phase is ScreenPhase.AuthRequired) {
            try {
                currentView.provideCredentials(creds)
                mutable.update { it.copy(phase = ScreenPhase.Connecting) }
                return
            } catch (_: Exception) {
            }
        }
        connect(creds, fromStore = false)
    }

    fun forgetSavedCredentials() {
        pendingCredentials = null
        usingSavedCredentials = false
        mutable.update { it.copy(hasSavedCredentials = false) }
        viewModelScope.launch { phone.deleteScreenCredentials(machineId) }
    }

    fun togglePointerMode() {
        mutable.update {
            it.copy(
                pointerMode = if (it.pointerMode == PointerMode.Trackpad) {
                    PointerMode.DirectTouch
                } else {
                    PointerMode.Trackpad
                },
            )
        }
    }

    fun moveCursorTo(x: Float, y: Float) {
        val s = mutable.value
        if (s.frameWidth <= 0 || s.frameHeight <= 0) return
        val cx = x.coerceIn(0f, (s.frameWidth - 1).toFloat())
        val cy = y.coerceIn(0f, (s.frameHeight - 1).toFloat())
        mutable.update { it.copy(cursorPos = Offset(cx, cy)) }
        view?.pointer(cx.toInt().toUShort(), cy.toInt().toUShort(), 0U)
    }

    fun moveCursorBy(dx: Float, dy: Float) {
        val pos = mutable.value.cursorPos
        moveCursorTo(pos.x + dx, pos.y + dy)
    }

    fun click(buttonMask: UByte, at: Offset? = null) {
        if (at != null) moveCursorTo(at.x, at.y)
        val pos = mutable.value.cursorPos
        val x = pos.x.toInt().coerceAtLeast(0).toUShort()
        val y = pos.y.toInt().coerceAtLeast(0).toUShort()
        view?.pointer(x, y, buttonMask)
        view?.pointer(x, y, 0U)
    }

    fun scroll(deltaX: Byte, deltaY: Byte) {
        val pos = mutable.value.cursorPos
        val x = pos.x.toInt().coerceAtLeast(0).toUShort()
        val y = pos.y.toInt().coerceAtLeast(0).toUShort()
        view?.scroll(x, y, deltaX, deltaY)
    }

    fun toggleModifier(mod: ModifierKey) {
        val active = mutable.value.activeModifiers
        if (mod in active) {
            view?.key(mod.keysym, false)
            mutable.update { it.copy(activeModifiers = it.activeModifiers - mod) }
        } else {
            view?.key(mod.keysym, true)
            mutable.update { it.copy(activeModifiers = it.activeModifiers + mod) }
        }
    }

    fun tapKey(keysym: UInt) {
        view?.key(keysym, true)
        view?.key(keysym, false)
        releaseAllModifiers()
    }

    fun typeText(text: String, pressReturn: Boolean) {
        if (text.isNotEmpty()) {
            view?.typeText(text)
        }
        if (pressReturn) {
            view?.shortcut(ScreenShortcut.Return)
        }
    }

    fun sendShortcut(shortcut: ScreenShortcut) {
        view?.shortcut(shortcut)
    }

    fun pasteClipboard(text: String) {
        if (text.isEmpty()) return
        view?.setClipboard(text)
        view?.shortcut(ScreenShortcut.Paste)
    }

    fun refresh() {
        view?.refresh()
    }

    private fun releaseAllModifiers() {
        val active = mutable.value.activeModifiers
        if (active.isEmpty()) return
        active.forEach { view?.key(it.keysym, false) }
        mutable.update { it.copy(activeModifiers = emptySet()) }
    }

    private suspend fun applyUpdate(update: ScreenUpdate) {
        when (update) {
            is ScreenUpdate.AuthRequired -> onAuthRequired(update.schemes)
            is ScreenUpdate.Ready -> onReady(update.width.toInt(), update.height.toInt(), update.desktopName)
            is ScreenUpdate.Frame -> onFrame(update)
            is ScreenUpdate.Resized -> onResized(update.width.toInt(), update.height.toInt())
            is ScreenUpdate.Cursor -> onCursor(update)
            is ScreenUpdate.PointerPos -> mutable.update {
                it.copy(cursorPos = Offset(update.x.toFloat(), update.y.toFloat()))
            }
            is ScreenUpdate.Clipboard -> mutable.update { it.copy(clipboardFromMac = update.text) }
            is ScreenUpdate.Closed -> onClosed(update.reason, update.detail)
        }
    }

    private fun onAuthRequired(schemes: List<AuthScheme>) {
        lastSchemes = schemes
        mutable.update { it.copy(phase = ScreenPhase.AuthRequired(schemes, errorMessage = null)) }
    }

    private suspend fun onReady(width: Int, height: Int, desktopName: String) {
        val (toSave, remember) = withContext(Dispatchers.Main.immediate) {
            val pending = pendingCredentials
            pendingCredentials = null
            usingSavedCredentials = false
            pending to rememberPending
        }
        if (toSave != null) {
            if (remember) {
                phone.saveScreenCredentials(machineId, toSave.username, toSave.password)
                mutable.update { it.copy(hasSavedCredentials = true) }
            } else {
                phone.deleteScreenCredentials(machineId)
                mutable.update { it.copy(hasSavedCredentials = false) }
            }
        }
        withContext(Dispatchers.Main.immediate) {
            val img = frameBuffer.ensure(width, height)?.second
            mutable.update {
                it.copy(
                    phase = ScreenPhase.Live,
                    desktopName = desktopName,
                    frameWidth = width,
                    frameHeight = height,
                    frameBitmap = img,
                    cursorPos = Offset(width / 2f, height / 2f),
                )
            }
        }
    }

    private suspend fun onFrame(update: ScreenUpdate.Frame) {
        val w = update.width.toInt()
        val h = update.height.toInt()
        val rx = update.x.toInt()
        val ry = update.y.toInt()
        val rw = update.rectWidth.toInt()
        val rh = update.rectHeight.toInt()
        val pixels = ScreenFrameBuffer.decodeRgbaToArgb(rw, rh, update.rgba) ?: return
        withContext(Dispatchers.Main.immediate) {
            val imageBitmap = frameBuffer.applyRect(w, h, rx, ry, rw, rh, pixels) ?: return@withContext
            mutable.update {
                it.copy(
                    phase = ScreenPhase.Live,
                    frameWidth = w,
                    frameHeight = h,
                    frameBitmap = imageBitmap,
                    frameVersion = it.frameVersion + 1L,
                )
            }
        }
    }

    private suspend fun onResized(width: Int, height: Int) {
        withContext(Dispatchers.Main.immediate) {
            val img = frameBuffer.ensure(width, height)?.second
            mutable.update { it.copy(frameWidth = width, frameHeight = height, frameBitmap = img) }
        }
    }

    private fun onCursor(update: ScreenUpdate.Cursor) {
        val cursorImg = ScreenFrameBuffer.cursorBitmap(update.width.toInt(), update.height.toInt(), update.rgba)
        mutable.update {
            it.copy(
                cursorBitmap = cursorImg,
                cursorHotspot = Offset(update.hotspotX.toFloat(), update.hotspotY.toFloat()),
            )
        }
    }

    private suspend fun onClosed(reason: ScreenCloseReason, detail: String) {
        val forgetSaved = withContext(Dispatchers.Main.immediate) {
            view = null
            var shouldForget = false
            val next = when (reason) {
                ScreenCloseReason.SCREEN_SHARING_DISABLED ->
                    ScreenPhase.Disabled(detail.ifBlank { "Turn on Screen Sharing on your Mac." })
                ScreenCloseReason.AUTH_FAILED -> {
                    pendingCredentials = null
                    val msg = if (usingSavedCredentials) {
                        usingSavedCredentials = false
                        shouldForget = true
                        "Your saved Mac password was rejected. Enter your current password."
                    } else {
                        detail.ifBlank { "Wrong username or password. Try again." }
                    }
                    ScreenPhase.AuthRequired(lastSchemes, errorMessage = msg)
                }
                ScreenCloseReason.NORMAL -> ScreenPhase.Closed("Session ended")
                else -> ScreenPhase.Closed(detail.ifBlank { "Disconnected" })
            }
            mutable.update {
                it.copy(
                    phase = next,
                    activeModifiers = emptySet(),
                    hasSavedCredentials = if (shouldForget) false else it.hasSavedCredentials,
                )
            }
            shouldForget
        }
        if (forgetSaved) {
            phone.deleteScreenCredentials(machineId)
        }
    }

    private fun disconnect() {
        releaseAllModifiers()
        view?.detach()
        view = null
        pumpJob?.cancel()
        pumpJob = null
    }

    override fun onCleared() {
        disconnect()
        frameBuffer.recycle()
        super.onCleared()
    }
}
