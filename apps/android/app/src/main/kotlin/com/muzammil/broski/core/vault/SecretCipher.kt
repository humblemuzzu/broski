package com.muzammil.broski.core.vault

import java.security.GeneralSecurityException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Seals and opens the vault's values. `label` is authenticated with each value, so a sealed value
 * moved under another name does not open.
 */
interface SecretCipher {
    fun seal(plain: ByteArray, label: String): ByteArray

    /** @throws GeneralSecurityException when the value was not sealed under `label` with this key. */
    fun open(sealed: ByteArray, label: String): ByteArray
}

/**
 * AES-256-GCM, stored as `iv ‖ ciphertext ‖ tag`. The cipher picks each IV: an Android Keystore key
 * refuses one chosen by the caller.
 */
class AesGcmCipher(private val key: () -> SecretKey) : SecretCipher {
    override fun seal(plain: ByteArray, label: String): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(label.encodeToByteArray())
        val iv = cipher.iv
        check(iv.size == IV_BYTES) { "AES-GCM chose a ${iv.size}-byte IV" }
        return iv + cipher.doFinal(plain)
    }

    override fun open(sealed: ByteArray, label: String): ByteArray {
        if (sealed.size < IV_BYTES + TAG_BITS / 8) throw GeneralSecurityException("too short to be sealed")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES))
        cipher.updateAAD(label.encodeToByteArray())
        return cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}
