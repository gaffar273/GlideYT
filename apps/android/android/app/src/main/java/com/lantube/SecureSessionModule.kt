package com.lantube

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.uimanager.ViewManager
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureSessionModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val preferences = context.getSharedPreferences("lan_tube", Context.MODE_PRIVATE)
    private val alias = "lan_tube_pairing"
    override fun getName(): String = "SecureSession"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    @ReactMethod
    fun save(value: String, promise: Promise) {
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            val stored = preferences.edit()
                .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .putString("session", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()
            if (!stored) throw IllegalStateException("Storage failed")
            promise.resolve(null)
        } catch (_: Exception) { promise.reject("STORAGE", "Cannot save pairing securely on this phone.") }
    }

    @ReactMethod
    fun load(promise: Promise) {
        try {
            val encrypted = preferences.getString("session", null)
            if (encrypted == null) { promise.resolve(null); return }
            val iv = Base64.decode(preferences.getString("iv", ""), Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)) }
            promise.resolve(String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8))
        } catch (_: Exception) {
            preferences.edit().clear().commit()
            promise.reject("STORAGE", "Saved pairing could not be read. Pair this phone again.")
        }
    }

    @ReactMethod
    fun clear(promise: Promise) {
        if (preferences.edit().clear().commit()) promise.resolve(null)
        else promise.reject("STORAGE", "Cannot remove saved pairing.")
    }
}

class SecureSessionPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(SecureSessionModule(context), RemoteTools(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
