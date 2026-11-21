package com.lantube

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import java.util.UUID
import com.facebook.react.bridge.*
import com.google.zxing.integration.android.IntentIntegrator

class RemoteTools(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "RemoteTools"
    override fun getConstants(): Map<String, Any> {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        val phoneId = if (!androidId.isNullOrBlank() && androidId != "9774d56d682e549c") {
            UUID.nameUUIDFromBytes(("com.lantube:" + androidId).toByteArray(Charsets.UTF_8)).toString()
        } else {
            val prefs = context.getSharedPreferences("phone_identity", Context.MODE_PRIVATE)
            prefs.getString("id", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("id", it).apply() }
        }
        return mapOf("phoneId" to phoneId, "phoneName" to Build.MODEL.ifBlank { "Android phone" })
    }
    private var pending: Promise? = null
    init {
        context.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                val result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data) ?: return
                pending?.resolve(result.contents)
                pending = null
            }
        })
    }

    @ReactMethod
    fun scan(promise: Promise) {
        val activity = context.currentActivity
        if (activity == null || pending != null) { promise.reject("SCAN", "Camera is busy."); return }
        activity.runOnUiThread {
            try {
                pending = promise
                IntentIntegrator(activity).setDesiredBarcodeFormats(listOf("QR_CODE"))
                    .setCaptureActivity(PairScannerActivity::class.java)
                    .setOrientationLocked(false).setBeepEnabled(false).initiateScan()
            } catch (error: Exception) { pending = null; promise.reject("SCAN", error) }
        }
    }

    @ReactMethod
    fun connect(address: String, token: String, laptop: String, promise: Promise) {
        try {
            val intent = Intent(context, RemotePlaybackService::class.java)
                .putExtra("address", address).putExtra("token", token).putExtra("laptop", laptop)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            promise.resolve(null)
        } catch (error: Exception) { promise.reject("MEDIA", error) }
    }

    @ReactMethod
    fun disconnect() { context.stopService(Intent(context, RemotePlaybackService::class.java)) }
}
