package com.echoflow.code.mobile

import android.content.Context
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class SavedCredentials(val serverUrl: String, val h5Token: String)

internal class CredentialStore(context: Context) {
  private val preferences = context.getSharedPreferences("echoflow.credentials", Context.MODE_PRIVATE)
  private val alias = "echoflow.mobile.credentials"

  fun load(): SavedCredentials? = runCatching {
    val iv = preferences.getString("iv", null) ?: return null
    val payload = preferences.getString("payload", null) ?: return null
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, decode(iv)))
    val value = String(cipher.doFinal(decode(payload)), StandardCharsets.UTF_8)
    val separator = value.indexOf('\n')
    if (separator <= 0) return null
    SavedCredentials(value.substring(0, separator), value.substring(separator + 1))
  }.getOrNull()

  fun save(credentials: SavedCredentials) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val value = "${credentials.serverUrl}\n${credentials.h5Token}"
    preferences.edit()
      .putString("iv", encode(cipher.iv))
      .putString("payload", encode(cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))))
      .apply()
  }

  fun clear() {
    preferences.edit().clear().apply()
  }

  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }

    val generator = KeyGenerator.getInstance("AES", "AndroidKeyStore")
    generator.init(
      android.security.keystore.KeyGenParameterSpec.Builder(
        alias,
        android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
          android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
        .build(),
    )
    return generator.generateKey()
  }

  private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
  private fun decode(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)
}
