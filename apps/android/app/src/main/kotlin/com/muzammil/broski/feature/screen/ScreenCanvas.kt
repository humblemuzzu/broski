package com.muzammil.broski.feature.screen

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.roundToInt

@Composable
internal fun ScreenCanvas(
    state: ScreenUiState,
    onMoveBy: (Float, Float) -> Unit,
    onClick: (UByte, Offset?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val currentState by rememberUpdatedState(state)
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
            .onSizeChanged { viewport = it }
            .tapInput({ currentState }, { viewport }, { zoom }, { pan }, onClick)
            .transformInput({ currentState }, { viewport }, { zoom }, { zoom = it }, { pan = it }, { pan }, onMoveBy),
        contentAlignment = Alignment.Center,
    ) {
        val frame = state.frameBitmap
        if (frame == null) {
            CircularProgressIndicator(color = Color.White)
        } else {
            ScreenFrameSurface(state, frame, zoom, pan)
        }
    }
}

private fun Modifier.tapInput(
    state: () -> ScreenUiState,
    viewport: () -> IntSize,
    zoom: () -> Float,
    pan: () -> Offset,
    onClick: (UByte, Offset?) -> Unit,
): Modifier = pointerInput(Unit) {
    detectTapGestures(
        onTap = { tap -> dispatchClick(1U, tap, state(), viewport(), zoom(), pan(), onClick) },
        onLongPress = { tap -> dispatchClick(4U, tap, state(), viewport(), zoom(), pan(), onClick) },
    )
}

private fun dispatchClick(
    button: UByte,
    tap: Offset,
    s: ScreenUiState,
    viewport: IntSize,
    zoom: Float,
    pan: Offset,
    onClick: (UByte, Offset?) -> Unit,
) {
    if (s.pointerMode == PointerMode.Trackpad) {
        onClick(button, null)
    } else {
        toRemote(tap, viewport, s, zoom, pan)?.let { onClick(button, it) }
    }
}

@Suppress("LongParameterList")
private fun Modifier.transformInput(
    state: () -> ScreenUiState,
    viewport: () -> IntSize,
    zoom: () -> Float,
    setZoom: (Float) -> Unit,
    setPan: (Offset) -> Unit,
    pan: () -> Offset,
    onMoveBy: (Float, Float) -> Unit,
): Modifier = pointerInput(Unit) {
    detectTransformGestures { _, gesturePan, gestureZoom, _ ->
        val s = state()
        if (gestureZoom != 1f) {
            val next = (zoom() * gestureZoom).coerceIn(1f, 5f)
            setZoom(next)
            if (next <= 1.01f) setPan(Offset.Zero)
        } else if (s.pointerMode == PointerMode.Trackpad) {
            val fitted = fittedRect(viewport(), s.frameWidth, s.frameHeight)
            val scale = if (fitted.width > 0f && s.frameWidth > 0) {
                (s.frameWidth / fitted.width) * 1.15f / zoom().coerceAtLeast(1f)
            } else {
                1.5f
            }
            onMoveBy(gesturePan.x * scale, gesturePan.y * scale)
        } else if (zoom() > 1.01f) {
            setPan(pan() + gesturePan)
        }
    }
}

@Composable
private fun ScreenFrameSurface(state: ScreenUiState, frame: ImageBitmap, zoom: Float, pan: Offset) {
    Canvas(modifier = Modifier.fillMaxSize()) {
        if (state.frameVersion < 0L) return@Canvas
        val fitted = fittedRect(
            IntSize(size.width.roundToInt(), size.height.roundToInt()),
            state.frameWidth,
            state.frameHeight,
        )
        val cx = size.width / 2f
        val cy = size.height / 2f
        val dstW = fitted.width * zoom
        val dstH = fitted.height * zoom
        val dstX = cx + (fitted.left - cx) * zoom + pan.x
        val dstY = cy + (fitted.top - cy) * zoom + pan.y

        drawImage(
            image = frame,
            dstOffset = IntOffset(dstX.roundToInt(), dstY.roundToInt()),
            dstSize = IntSize(dstW.roundToInt().coerceAtLeast(1), dstH.roundToInt().coerceAtLeast(1)),
        )
        drawCursor(state, dstX, dstY, dstW, dstH)
    }
}

private fun DrawScope.drawCursor(state: ScreenUiState, dstX: Float, dstY: Float, dstW: Float, dstH: Float) {
    if (state.frameWidth <= 0 || state.frameHeight <= 0) return
    val sx = dstW / state.frameWidth
    val sy = dstH / state.frameHeight
    val curX = dstX + state.cursorPos.x * sx
    val curY = dstY + state.cursorPos.y * sy
    val cursorImg = state.cursorBitmap
    if (cursorImg != null) {
        drawImage(
            image = cursorImg,
            dstOffset = IntOffset(
                (curX - state.cursorHotspot.x * sx).roundToInt(),
                (curY - state.cursorHotspot.y * sy).roundToInt(),
            ),
            dstSize = IntSize(
                (cursorImg.width * sx).roundToInt().coerceAtLeast(18),
                (cursorImg.height * sy).roundToInt().coerceAtLeast(18),
            ),
        )
    } else {
        drawCircle(color = Color.White, radius = 8f, center = Offset(curX, curY))
        drawCircle(color = Color.Black, radius = 8f, center = Offset(curX, curY), style = Stroke(2f))
    }
}

private data class FitRect(val left: Float, val top: Float, val width: Float, val height: Float)

private fun fittedRect(container: IntSize, frameW: Int, frameH: Int): FitRect {
    if (container.width <= 0 || container.height <= 0 || frameW <= 0 || frameH <= 0) {
        return FitRect(0f, 0f, container.width.toFloat(), container.height.toFloat())
    }
    val cw = container.width.toFloat()
    val ch = container.height.toFloat()
    val aspect = frameW.toFloat() / frameH.toFloat()
    val containerAspect = cw / ch
    val size = if (aspect > containerAspect) Size(cw, cw / aspect) else Size(ch * aspect, ch)
    return FitRect((cw - size.width) / 2f, (ch - size.height) / 2f, size.width, size.height)
}

private fun toRemote(
    point: Offset,
    container: IntSize,
    state: ScreenUiState,
    zoom: Float,
    pan: Offset,
): Offset? {
    if (state.frameWidth <= 0 || state.frameHeight <= 0) return null
    val fitted = fittedRect(container, state.frameWidth, state.frameHeight)
    if (fitted.width <= 0f || fitted.height <= 0f) return null
    val cx = container.width / 2f
    val cy = container.height / 2f
    val ux = (point.x - pan.x - cx) / zoom + cx
    val uy = (point.y - pan.y - cy) / zoom + cy
    val rx = (ux - fitted.left) / fitted.width
    val ry = (uy - fitted.top) / fitted.height
    if (rx !in 0f..1f || ry !in 0f..1f) return null
    return Offset(rx * state.frameWidth, ry * state.frameHeight)
}
