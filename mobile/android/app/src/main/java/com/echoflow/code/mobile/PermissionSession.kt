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

  fun connect(serverUrl: String, token: String, sessionId: String) {
    if (connectedSessionId == sessionId) return
    disconnect()

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
          when (message.optString("type")) {
            "control_request" -> {
              val request = message.optJSONObject("request") ?: return
              if (request.optString("subtype") == "can_use_tool" && message.has("request_id")) {
                request.put("request_id", message.optString("request_id"))
                onRequest(request)
              }
            }
            "control_cancel_request", "control_response" -> {
              message.optString("request_id").takeIf(String::isNotBlank)?.let(onCancel)
            }
          }
        }

        override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
          if (socket === webSocket) disconnect()
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          if (socket === webSocket) {
            socket = null
            connectedSessionId = null
          }
        }
      },
    )
  }

  fun respond(requestId: String, allowed: Boolean) {
    val response = JSONObject().apply {
      put("type", "control_response")
      put("response", JSONObject().apply {
        put("subtype", "success")
        put("request_id", requestId)
        put("response", if (allowed) {
          JSONObject().apply {
            put("behavior", "allow")
            put("updatedInput", JSONObject())
          }
        } else {
          JSONObject().apply {
            put("behavior", "deny")
            put("message", "Denied by user")
          }
        })
      })
    }
    socket?.send(response.toString())
  }

  fun disconnect() {
    socket?.close(1000, "WebView session changed")
    socket = null
    connectedSessionId = null
  }

  fun destroy() {
    disconnect()
    client.dispatcher.executorService.shutdown()
    client.connectionPool.evictAll()
  }
}
