package com.lantube

import android.os.SystemClock
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object LaptopDiscovery {
    private var lastQuery = ""
    private var lastAttempt = -10000L
    private var found: String? = null
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    @Synchronized
    fun find(address: String, token: String): String? {
        val now = SystemClock.elapsedRealtime()
        if (lastQuery == token && now - lastAttempt < 6000) return found
        lastQuery = token
        lastAttempt = now
        found = null
        try {
            val port = URI(address).port
            val key = MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8))
            val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
            fun sign(message: String) = hex(mac.doFinal(message.toByteArray(Charsets.UTF_8)))
            val nonce = hex(ByteArray(16).also { SecureRandom().nextBytes(it) })
            val query = "GlideYT-find $nonce ${sign("find $nonce")}".toByteArray(Charsets.UTF_8)
            DatagramSocket().use { socket ->
                socket.broadcast = true
                val targets = mutableSetOf(InetAddress.getByName("255.255.255.255"))
                NetworkInterface.getNetworkInterfaces()?.toList()?.filter { it.isUp && !it.isLoopback }
                    ?.forEach { net -> net.interfaceAddresses.mapNotNullTo(targets) { it.broadcast } }
                for (target in targets) runCatching { socket.send(DatagramPacket(query, query.size, target, port)) }
                val deadline = SystemClock.elapsedRealtime() + 1200
                while (SystemClock.elapsedRealtime() < deadline) {
                    socket.soTimeout = (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(1).toInt()
                    val reply = DatagramPacket(ByteArray(2048), 2048)
                    socket.receive(reply)
                    val value = String(reply.data, reply.offset, reply.length, Charsets.US_ASCII)
                    val message = value.substringBeforeLast(' ')
                    val candidate = "http://${reply.address.hostAddress}:$port"
                    if (message.startsWith("GlideYT-here $nonce ") && candidate in message.split(' ').drop(2)
                        && reply.port == port && reply.address.isSiteLocalAddress
                        && MessageDigest.isEqual(sign(message).toByteArray(), value.substringAfterLast(' ').toByteArray())) {
                        found = candidate
                        break
                    }
                }
            }
        } catch (_: Exception) { /* Retry after the laptop or Wi-Fi returns. */ }
        return found
    }
}
