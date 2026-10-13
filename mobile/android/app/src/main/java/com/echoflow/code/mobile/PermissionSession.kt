package com.echoflow.code.mobile

import android.net.Uri
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

internal class PermissionSession(
  private val onRequest: (JSONObject) -> Unit,
  private val onCancel: (String) -> Unit,
) {
  private val client = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .build()
  private var socket: WebSocket? = null
  private var connectedSessionId: String? = null
  private var connectionGeneration = 0L
  private val pendingRequestIds = mutableSetOf<String>()

  fun connect(serverUrl: String, token: String, sessionId: String) {
    if (connectedSessionId == sessionId) return
    disconnect()

    val generation = ++connectionGeneration
    val server = Uri.parse(serverUrl)
    val url = server.buildUpon()
      .scheme(if (server.scheme == "https") "wss" else "ws")
      .appendPath("ws")
      .appendPath(sessionId)
      .appendQueryParameter("token", token)
      .build()
    connectedSessionId = sessionId
    socket = client.newWebSocket(
      Request.Builder().url(url.toString()).build(),
      object : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
          val message = runCatching { JSONObject(text) }.getOrNull() ?: return
          if (generation != connectionGeneration || socket !== webSocket) return
          when (message.optString("type")) {
            "permission_request" -> {
              if (message.optString("toolName") == "AskUserQuestion") return
              val requestId = message.optString("requestId")
              if (requestId.isNotBlank() && pendingRequestIds.add(requestId)) {
                message.put("request_id", requestId)
                message.put("tool_name", message.optString("toolName"))
                message.put("display_name", message.optString("displayName"))
                onRequest(message)
              }
            }
            "permission_resolved" -> {
              message.optString("requestId").takeIf(String::isNotBlank)?.let {
                pendingRequestIds.remove(it)
                onCancel(it)
              }
            }
          }
        }

        override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
          if (socket === webSocket) disconnect()
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          if (socket === webSocket) {
            val requestIds = pendingRequestIds.toList()
            socket = null
            connectedSessionId = null
            pendingRequestIds.clear()
            requestIds.forEach(onCancel)
          }
        }
      },
    )
  }

  fun respond(requestId: String, allowed: Boolean) {
    if (!pendingRequestIds.remove(requestId)) return
    val response = JSONObject().apply {
      put("type", "permission_response")
      put("requestId", requestId)
      put("allowed", allowed)
      if (!allowed) put("denyMessage", "Denied by user")
    }
    socket?.send(response.toString())
  }

  fun disconnect() {
    connectionGeneration += 1
    socket?.close(1000, "WebView session changed")
    socket = null
    connectedSessionId = null
    val requestIds = pendingRequestIds.toList()
    pendingRequestIds.clear()
    requestIds.forEach(onCancel)
  }

  fun destroy() {
    disconnect()
    client.dispatcher.executorService.shutdown()
    client.connectionPool.evictAll()
  }
}
