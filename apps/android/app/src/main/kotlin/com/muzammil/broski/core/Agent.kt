package com.muzammil.broski.core

import androidx.compose.runtime.Immutable
import uniffi.broski_contract.BackendDescriptor
import uniffi.broski_contract.BackendIconHint

/** Backend ids as the contract spells them: `claude-code`, `pi`, or any other adapter's. */
object BackendIds {
    const val CLAUDE_CODE = "claude-code"
    const val PI = "pi"

    private val wire = Regex("[a-z0-9][a-z0-9-]{0,63}")

    fun isValid(id: String): Boolean = wire.matches(id)
}

/**
 * What the app shows of an agent backend: the machine's descriptor of it, or, for a cached row or a
 * machine that has not listed its backends yet, what its id alone says. Claude Code and Pi always
 * keep their own art.
 */
@Immutable
data class Agent(val id: String, val name: String, val accentHex: String? = null, val icon: BackendIconHint? = null) {
    companion object {
        fun of(descriptor: BackendDescriptor) = Agent(
            id = descriptor.id,
            name = descriptor.displayName,
            accentHex = descriptor.accentHex,
            icon = known(descriptor.id).icon ?: descriptor.iconHint,
        )

        fun known(id: String): Agent = when (id) {
            BackendIds.CLAUDE_CODE -> Agent(id, "Claude Code", icon = BackendIconHint.CLAUDE)
            BackendIds.PI -> Agent(id, "Pi", icon = BackendIconHint.PI)
            else -> Agent(id, titled(id))
        }
    }
}

/** `open-code` as "Open Code": a name for an id that came with none. */
fun titled(id: String): String = id.split('-').filter(String::isNotEmpty).joinToString(" ") { it.replaceFirstChar(Char::uppercaseChar) }
