package com.muzammil.broski.feature.chat.transcript

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.muzammil.broski.feature.chat.SessionClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.broski_contract.AttachmentReadResult
import uniffi.broski_core.ClientException

/**
 * Images the conversation names by reference (contract README §10), read with `attachment.read`
 * when a row first shows them and kept for the chat's life; one that fails is not read again.
 */
class AttachmentCache(private val client: SessionClient, private val scope: CoroutineScope) {
    private val mutable = MutableStateFlow<Map<String, ImageBitmap>>(emptyMap())
    private val asked = HashSet<String>()

    val images: StateFlow<Map<String, ImageBitmap>> = mutable.asStateFlow()

    fun request(id: String) {
        synchronized(asked) { if (!asked.add(id)) return }
        scope.launch {
            val result = try {
                client.attachment(id)
            } catch (_: ClientException) {
                null
            }
            val image = (result as? AttachmentReadResult.Accepted)?.v1?.image ?: return@launch
            val bitmap = withContext(Dispatchers.Default) {
                val bytes = Base64.decode(image.data, Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            } ?: return@launch
            mutable.update { it + (id to bitmap) }
        }
    }
}
