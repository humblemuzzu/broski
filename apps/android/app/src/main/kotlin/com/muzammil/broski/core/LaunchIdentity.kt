package com.muzammil.broski.core

import com.muzammil.broski.core.vault.Vault
import uniffi.broski_core.newIdentitySecret

/** No identity is stored, yet pairings are: a new one would orphan every Mac this phone controls. */
class MissingIdentityException : Exception("pairings are stored, but the identity they belong to is not")

/**
 * The identity secret to open the phone with: the stored one, or a new one on the first run only,
 * when nothing is paired. A secret that is stored but does not open throws from the vault.
 *
 * @throws MissingIdentityException when no identity is stored but pairings are.
 */
internal suspend fun launchIdentity(vault: Vault): ByteArray {
    vault.identity()?.let { return it }
    val stored = vault.records()
    if (stored.readable.isNotEmpty() || stored.unreadable.isNotEmpty()) throw MissingIdentityException()
    return newIdentitySecret().also { vault.saveIdentity(it) }
}
