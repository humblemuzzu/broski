package com.muzammil.broski.feature.workspace.files

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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

/** What `fs.read` gave: text the viewer shows by line, or bytes it shows as an image when they decode as one. */
sealed interface FileContent {
    /** The whole file's size, of which the content covers the first [shown] bytes. */
    val size: Long
    val shown: Long
    val truncated: Boolean get() = shown < size

    data class Text(val lines: List<String>, override val size: Long, override val shown: Long) : FileContent

    class Bytes(val bytes: ByteArray, override val size: Long, override val shown: Long) : FileContent

    companion object {
        fun of(read: FileRead): FileContent = when (read.encoding) {
            FileEncoding.UTF8 -> Text(textLines(read.content), read.size, read.offset + read.length)
            FileEncoding.BASE64 -> Bytes(Base64.getDecoder().decode(read.content), read.size, read.offset + read.length)
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
            mutableState.value = when (val answer = client.read(path)) {
                is Answer.Done -> FileUiState.Shown(withContext(Dispatchers.Default) { FileContent.of(answer.value) })
                is Answer.Failed -> FileUiState.Failed(answer.failure)
            }
        }
    }
}
