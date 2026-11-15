package com.muzammil.broski.feature.chat.composer

import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.broski_contract.CommandSummary
import uniffi.broski_contract.PromptInput
import uniffi.broski_contract.PromptMode
import java.util.UUID

/** What a send takes out of the composer, and puts back if it does not go through. */
class Outgoing(val input: PromptInput, val images: List<ComposerImage>, val command: CommandSummary?)

/**
 * The composer's state: the text field, the command picked from the `/` list, and the images
 * waiting to go. The text is the draft, handed to [saveDraft] a moment after the person stops typing.
 */
class ComposerState(initialText: String, scope: CoroutineScope, private val saveDraft: (String) -> Unit) {
    val input = TextFieldState(initialText)
    private val mutableCommand = MutableStateFlow<CommandSummary?>(null)
    private val mutableImages = MutableStateFlow<List<ComposerImage>>(emptyList())

    val command: StateFlow<CommandSummary?> = mutableCommand.asStateFlow()
    val images: StateFlow<List<ComposerImage>> = mutableImages.asStateFlow()

    /** The base64 the waiting images leave for one more. */
    val imageBudget: Int get() = MAX_IMAGE_CHARS - mutableImages.value.sumOf { it.base64.length }

    init {
        @OptIn(FlowPreview::class)
        scope.launch {
            snapshotFlow { input.text.toString() }.drop(1).debounce(DRAFT_PAUSE_MS).collect(saveDraft)
        }
    }

    /** The `/` command the person picked: the field keeps only its arguments. */
    fun pick(command: CommandSummary) {
        mutableCommand.value = command
        input.setTextAndPlaceCursorAtEnd(input.text.toString().substringAfter(' ', "").trimStart())
    }

    fun clearCommand() {
        mutableCommand.value = null
    }

    fun add(image: ComposerImage) = mutableImages.update { it + image }

    fun remove(id: String) = mutableImages.update { list -> list.filterNot { it.id == id } }

    /** Texts the backend handed back from its queue go in front of what is typed, a blank line apart. */
    fun prepend(texts: List<String>) {
        val typed = input.text.toString()
        input.setTextAndPlaceCursorAtEnd((texts + typed).filter { it.isNotEmpty() }.joinToString("\n\n"))
    }

    /** Everything typed, as a prompt in [mode], with a fresh request id; the composer is left empty. */
    fun take(mode: PromptMode): Outgoing {
        val images = mutableImages.value
        val command = mutableCommand.value
        val text = input.text.toString().trim()
        val prompt = PromptInput(UUID.randomUUID().toString(), mode, text, images.map { it.attachment() }, command?.id)
        input.clearText()
        mutableImages.value = emptyList()
        mutableCommand.value = null
        saveDraft("")
        return Outgoing(prompt, images, command)
    }

    /** A send that did not go: its text, images and command come back, in front of anything typed since. */
    fun restore(outgoing: Outgoing) {
        prepend(listOf(outgoing.input.text))
        mutableImages.update { outgoing.images + it }
        if (mutableCommand.value == null) mutableCommand.value = outgoing.command
    }

    private companion object {
        const val DRAFT_PAUSE_MS = 400L
    }
}
