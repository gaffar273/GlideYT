package com.lantube

import android.app.Activity
import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.*
import com.google.zxing.integration.android.IntentIntegrator

class RemoteTools(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "RemoteTools"
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
                    .setOrientationLocked(false).setBeepEnabled(false)
                    .setPrompt("Scan the pairing code on your laptop").initiateScan()
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
