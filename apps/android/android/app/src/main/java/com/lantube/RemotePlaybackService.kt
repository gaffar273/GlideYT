package com.lantube

import android.app.*
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.*
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import org.json.JSONObject

class RemotePlaybackService : Service() {
    private lateinit var media: MediaSession
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var address = ""
    private var token = ""
    private var laptop = ""
    private var state = JSONObject()
    private var generation = 0
    private val poll = Runnable { request() }

    override fun onBind(intent: Intent?) = null
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel("remote", "Laptop playback", NotificationManager.IMPORTANCE_LOW))
        media = MediaSession(this, "Laptop playback")
        media.setCallback(object : MediaSession.Callback() {
            override fun onPlay() = control("play")
            override fun onPause() = control("pause")
            override fun onSeekTo(pos: Long) = seek(pos / 1000.0)
            override fun onRewind() = skip(-10)
            override fun onFastForward() = skip(10)
            override fun onCustomAction(action: String, extras: Bundle?) { when(action) { "back" -> skip(-10); "forward" -> skip(10) } }
        })
        media.isActive = true
    }
    private fun control(type: String) { request(JSONObject().put("type", type)) }
    private fun seek(seconds: Double) { request(JSONObject().put("type", "seek").put("seconds", seconds.coerceAtLeast(0.0))) }
    private var observed = 0L
    private fun skip(delta: Int) {
        val elapsed = if (state.optBoolean("playing")) (SystemClock.elapsedRealtime() - observed) / 1000.0 else 0.0
        seek(state.optDouble("position", 0.0) + elapsed + delta)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.hasExtra("address") == true) {
            generation++
            address = intent.getStringExtra("address").orEmpty()
            token = intent.getStringExtra("token").orEmpty()
            laptop = intent.getStringExtra("laptop").orEmpty()
            startForeground(1, notification())
            request()
        } else if (address.isNotEmpty()) {
            when(intent?.action) { "play","pause" -> control(intent.action!!); "back" -> skip(-10); "forward" -> skip(10) }
        } else stopSelf()
        return START_NOT_STICKY
    }

    private fun request(command: JSONObject? = null) {
        main.removeCallbacks(poll)
        val current = generation
        val base = address
        val bearer = token
        worker.execute {
            val connection = URL(base + if (command == null) "/v1/state" else "/v1/command").openConnection() as HttpURLConnection
            var revoked = false
            val result = try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 3500
                connection.readTimeout = 5000
                connection.setRequestProperty("Authorization", "Bearer " + bearer)
                if (command != null) {
                    connection.requestMethod = "POST"
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use { it.write(command.toString().toByteArray()) }
                }
                revoked = connection.responseCode == 401
                val body = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                if (command == null) body else body.optJSONObject("state")
            } catch (_: Exception) { JSONObject() } finally { connection.disconnect() }
            main.post {
                if (current != generation) return@post
                if (revoked) { stopSelf(); return@post }
                if (result != null) { state = result; observed = SystemClock.elapsedRealtime() }
                getSystemService(NotificationManager::class.java).notify(1, notification())
                main.removeCallbacks(poll)
                main.postDelayed(poll, if (result == null) 100L else if (state.optBoolean("connected")) 4000L else 12000L)
            }
        }
    }

    private fun notification(): Notification {
        val playing = state.optBoolean("playing")
        val ready = state.optBoolean("ready")
        val seekable = ready && !state.optBoolean("live")
        val title = state.optString("title").takeIf { it.isNotBlank() && it != "null" } ?: "YouTube on laptop"
        val track = PlaybackState.Builder().setState(if (!ready) PlaybackState.STATE_STOPPED else if (playing)
            PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, (state.optDouble("position", 0.0)*1000).toLong(), if (playing) 1f else 0f)
        var actions = if (ready) PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE else 0L
        if (seekable) {
            actions = actions or PlaybackState.ACTION_SEEK_TO
            track.addCustomAction("back", "Back 10 seconds", android.R.drawable.ic_media_rew)
            track.addCustomAction("forward", "Forward 10 seconds", android.R.drawable.ic_media_ff)
        }
        media.setPlaybackState(track.setActions(actions).build())
        media.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, laptop)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, (state.optDouble("duration", 0.0)*1000).toLong()).build())
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "remote") else Notification.Builder(this)
        builder.setColor(android.graphics.Color.rgb(30, 215, 96)).setSmallIcon(R.drawable.ic_notification).setContentTitle(title).setContentText(laptop).setOnlyAlertOnce(true)
            .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
        val style = Notification.MediaStyle().setMediaSession(media.sessionToken)
        if (ready) {
            fun add(action: String, label: String, icon: Int) {
                val intent = Intent(this, RemotePlaybackService::class.java).setAction(action)
                builder.addAction(icon, label, PendingIntent.getService(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
            }
            if (seekable) add("back", "Back 10 seconds", android.R.drawable.ic_media_rew)
            if (playing) add("pause", "Pause", android.R.drawable.ic_media_pause) else add("play", "Play", android.R.drawable.ic_media_play)
            if (seekable) add("forward", "Forward 10 seconds", android.R.drawable.ic_media_ff)
            style.setShowActionsInCompactView(*(if (seekable) intArrayOf(0,1,2) else intArrayOf(0)))
        }
        return builder.setStyle(style).build()
    }
    override fun onDestroy() {
        generation++
        main.removeCallbacksAndMessages(null)
        worker.shutdownNow()
        media.release()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
