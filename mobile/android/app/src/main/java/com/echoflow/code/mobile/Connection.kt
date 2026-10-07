package com.echoflow.code.mobile

import android.net.Uri
import java.net.HttpURLConnection
import java.net.URL

internal class ConnectionException(message: String) : Exception(message)

internal object Connection {
  fun normalizeServerUrl(value: String): String {
    val uri = runCatching { Uri.parse(value.trim()) }.getOrNull()
      ?: throw ConnectionException("请输入有效的服务器地址")
    if (uri.scheme !in listOf("http", "https") || uri.host.isNullOrBlank()) {
      throw ConnectionException("服务器地址必须使用 HTTP 或 HTTPS")
    }
    return uri.buildUpon().path(null).clearQuery().fragment(null).build().toString().trimEnd('/')
  }

  fun verify(serverUrl: String, token: String): String {
    val normalized = normalizeServerUrl(serverUrl)
    if (token.trim().isEmpty()) throw ConnectionException("请输入 H5 Token")
    val health = request("$normalized/health", null)
    try {
      if (health.responseCode !in 200..299) throw ConnectionException("服务器不可用（HTTP ${health.responseCode}）")
    } finally {
      health.disconnect()
    }
    val verification = request("$normalized/api/h5-access/verify", token.trim())
    try {
      val status = verification.responseCode
      if (status == 401 || status == 403) {
        throw ConnectionException("H5 Token 无效或已过期")
      }
      if (status !in 200..299) {
        throw ConnectionException("Token 验证失败（HTTP $status）")
      }
    } finally {
      verification.disconnect()
    }
    return normalized
  }

  fun launchUrl(credentials: SavedCredentials): String = Uri.parse(credentials.serverUrl).buildUpon()
    .appendQueryParameter("serverUrl", credentials.serverUrl)
    .appendQueryParameter("h5Token", credentials.h5Token)
    .build()
    .toString()

  fun originRule(serverUrl: String): String {
    val uri = Uri.parse(normalizeServerUrl(serverUrl))
    val host = uri.host ?: throw ConnectionException("服务器地址无效")
    val formattedHost = if (host.contains(':')) "[$host]" else host
    val defaultPort = if (uri.scheme == "https") 443 else 80
    val port = uri.port.takeIf { it >= 0 && it != defaultPort }?.let { ":$it" }.orEmpty()
    return "${uri.scheme?.lowercase()}://$formattedHost$port"
  }

  fun isSameOrigin(serverUrl: String, origin: String): Boolean {
    val server = Uri.parse(normalizeServerUrl(serverUrl))
    val source = runCatching { Uri.parse(origin) }.getOrNull() ?: return false
    return server.scheme == source.scheme && server.host.equals(source.host, ignoreCase = true) &&
      effectivePort(server) == effectivePort(source)
  }

  private fun effectivePort(uri: Uri): Int =
    uri.port.takeIf { it >= 0 } ?: if (uri.scheme == "https") 443 else 80

  fun parseIntent(uri: Uri?): SavedCredentials? {
    if (uri == null) return null
    val serverUrl = uri.getQueryParameter("serverUrl") ?: return null
    val token = uri.getQueryParameter("h5Token") ?: return null
    if (token.isBlank()) return null
    return runCatching { SavedCredentials(normalizeServerUrl(serverUrl), token.trim()) }.getOrNull()
  }

  private fun request(endpoint: String, token: String?): HttpURLConnection {
    val connection = URL(endpoint).openConnection() as HttpURLConnection
    connection.connectTimeout = 8_000
    connection.readTimeout = 8_000
    connection.useCaches = false
    if (token != null) {
      connection.requestMethod = "POST"
      connection.setRequestProperty("Authorization", "Bearer $token")
      connection.setRequestProperty("Content-Type", "application/json")
    }
    connection.connect()
    return connection
  }
}
