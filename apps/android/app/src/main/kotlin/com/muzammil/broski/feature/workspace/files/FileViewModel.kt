package com.muzammil.broski.feature.workspace.files

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.feature.images.ChatImageStore
import com.muzammil.broski.feature.images.FullImagePayload
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.broski_contract.FileEncoding
import uniffi.broski_contract.FileRead
import uniffi.broski_contract.ImageVariant
import uniffi.broski_core.isImagePath

/** What `fs.read` or `fs.image` gave: text by line, a decoded image, or raw binary bytes. */
sealed interface FileContent {
    val size: Long
    val shown: Long
    val truncated: Boolean get() = shown < size

    data class Text(val lines: List<String>, override val size: Long, override val shown: Long) : FileContent

    class Image(val payload: FullImagePayload, override val size: Long) : FileContent {
        override val shown: Long get() = size
    }

    class Bytes(val bytes: ByteArray, override val size: Long, override val shown: Long) : FileContent

    companion object {
        fun of(read: FileRead): FileContent = when (read.encoding) {
            FileEncoding.UTF8 -> Text(textLines(read.content), read.size, read.offset + read.length)
            FileEncoding.BASE64 -> {
                val bytes = Base64.getDecoder().decode(read.content)
                val decoded = if (read.offset + read.length >= read.size) {
                    ChatImageStore.decodePayloadBytes(bytes, "image/png", null, null, read.size)
                } else {
                    null
                }
                if (decoded != null) Image(decoded, read.size) else Bytes(bytes, read.size, read.offset + read.length)
            }
        }

        /** The file's lines as shown: tabs at four columns, no line for the newline that ends the file. */
        fun textLines(content: String): List<String> {
            val lines = content.split("\r\n", "\n").map(::expandTabs)
            return if (lines.size > 1 && lines.last().isEmpty()) lines.dropLast(1) else lines
        }

        private fun expandTabs(line: String): String {
            if ('\t' !in line) return line
            return buildString {
                for (char in line) {
                    if (char == '\t') repeat(TAB_WIDTH - length % TAB_WIDTH) { append(' ') } else append(char)
                }
            }
        }

        private const val TAB_WIDTH = 4
    }
}

sealed interface FileUiState {
    data object Loading : FileUiState

    data class Shown(val content: FileContent) : FileUiState

    data class Failed(val failure: WorkspaceFailure) : FileUiState
}

class FileViewModel(private val client: WorkspaceClient, val path: String) : ViewModel() {
    private val mutableState = MutableStateFlow<FileUiState>(FileUiState.Loading)
    val state: StateFlow<FileUiState> = mutableState.asStateFlow()

    init {
        reload()
    }

    fun reload() {
        mutableState.value = FileUiState.Loading
        viewModelScope.launch {
            if (isImagePath(path)) {
                when (val imageAnswer = client.image(path, ImageVariant.FULL)) {
                    is Answer.Done -> {
                        val read = imageAnswer.value
                        val payload = withContext(Dispatchers.Default) {
                            ChatImageStore.decodePayload(read.data, read.mimeType, read.width?.toInt(), read.height?.toInt(), read.size)
                        }
                        mutableState.value = if (payload != null) {
                            FileUiState.Shown(FileContent.Image(payload, read.size))
                        } else {
                            FileUiState.Shown(FileContent.Bytes(ByteArray(0), read.size, read.size))
                        }
                        return@launch
                    }
                    is Answer.Failed -> {
                        if (imageAnswer.failure.reason != WorkspaceFailure.Reason.Refused) {
                            mutableState.value = FileUiState.Failed(imageAnswer.failure)
                            return@launch
                        }
                    }
                }
            }
            mutableState.value = when (val answer = client.read(path)) {
                is Answer.Done -> FileUiState.Shown(withContext(Dispatchers.Default) { FileContent.of(answer.value) })
                is Answer.Failed -> FileUiState.Failed(answer.failure)
            }
        }
    }
}
