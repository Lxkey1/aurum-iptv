package com.aurum.tv.data

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.annotation.RequiresApi
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Credential storage backed by the Android keystore.
 *
 * Fire OS 5 is API 22, which predates AndroidKeyStore AES support, so the
 * androidx.security library is not usable here. On API 23+ the password is
 * sealed with a hardware-backed AES-GCM key; below that it is only obfuscated
 * and the caller is told as much.
 */
class SecureStore(context: Context) {

    private val prefs = context.getSharedPreferences("aurum_secure", Context.MODE_PRIVATE)
    private val hardwareBacked = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M

    val isHardwareBacked: Boolean get() = hardwareBacked

    companion object {
        private const val KEY_ALIAS = "aurum_credentials"
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private const val IV_LENGTH = 12
        private const val TAG_BITS = 128

        private const val K_HOST = "host"
        private const val K_USER = "user"
        private const val K_PASS = "pass"
        private const val K_ENCRYPTED = "encrypted"
    }

    fun save(host: String, username: String, password: String) {
        val (payload, encrypted) = try {
            if (hardwareBacked) encrypt(password) to true else obfuscate(password) to false
        } catch (_: Exception) {
            obfuscate(password) to false
        }
        prefs.edit()
            .putString(K_HOST, host)
            .putString(K_USER, username)
            .putString(K_PASS, payload)
            .putBoolean(K_ENCRYPTED, encrypted)
            .apply()
    }

    fun load(): Triple<String, String, String>? {
        val host = prefs.getString(K_HOST, null) ?: return null
        val user = prefs.getString(K_USER, null) ?: return null
        val stored = prefs.getString(K_PASS, null) ?: return null
        val encrypted = prefs.getBoolean(K_ENCRYPTED, false)
        val password = try {
            if (encrypted) decrypt(stored) else deobfuscate(stored)
        } catch (_: Exception) {
            // Keystore was invalidated (factory reset, app data cleared) — force a fresh login.
            return null
        }
        return Triple(host, user, password)
    }

    fun clear() = prefs.edit().clear().apply()

    fun hasProfile(): Boolean = prefs.contains(K_PASS)

    // ------------------------------------------------------------ keystore

    @RequiresApi(Build.VERSION_CODES.M)
    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    @RequiresApi(Build.VERSION_CODES.M)
    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val combined = cipher.iv + encrypted
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    @RequiresApi(Build.VERSION_CODES.M)
    private fun decrypt(encoded: String): String {
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        val iv = combined.copyOfRange(0, IV_LENGTH)
        val body = combined.copyOfRange(IV_LENGTH, combined.size)
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
        return String(cipher.doFinal(body), Charsets.UTF_8)
    }

    // ------------------------------------------------- pre-M fallback only

    private fun obfuscate(plain: String): String {
        val bytes = plain.toByteArray(Charsets.UTF_8)
        val mask = "aurum".toByteArray(Charsets.UTF_8)
        val out = ByteArray(bytes.size) { i -> (bytes[i].toInt() xor mask[i % mask.size].toInt()).toByte() }
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    private fun deobfuscate(encoded: String): String {
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val mask = "aurum".toByteArray(Charsets.UTF_8)
        val out = ByteArray(bytes.size) { i -> (bytes[i].toInt() xor mask[i % mask.size].toInt()).toByte() }
        return String(out, Charsets.UTF_8)
    }
}
