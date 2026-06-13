/**
 * Injected JavaScript that monitors WebSocket connections inside the H5 WebView.
 *
 * It wraps the native WebSocket constructor to track open/close/error events,
 * then posts status updates to the React Native layer via postMessage.
 *
 * The injected code is self-contained (no external dependencies) and must be
 * safe for the H5 application — it does not alter WebSocket behaviour, only
 * observes it.
 */

export type WsConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'

export type WsBridgeMessage =
  | { type: 'codemobile:ws:status'; status: WsConnectionStatus; sessionId?: string }

export function isWsBridgeMessage(
  msg: unknown,
): msg is WsBridgeMessage {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Record<string, unknown>
  return (
    m.type === 'codemobile:ws:status' &&
    typeof m.status === 'string' &&
    ['connected', 'disconnected', 'reconnecting'].includes(m.status)
  )
}

/**
 * The JavaScript string injected into the WebView via `injectedJavaScript`.
 *
 * Strategy:
 *  1. Save the original WebSocket constructor.
 *  2. Replace it with a wrapper that creates the real socket and attaches
 *     listeners.
 *  3. Each time a socket opens, post "connected". When any socket closes and
 *     no other sockets are open, post "disconnected".  This works for the
 *     common case of one session WebSocket, plus optional extra sockets.
 */
export function createWsMonitorScript(): string {
  // Use an IIFE so variables don't leak into the H5 global scope.
  return `
(function() {
  'use strict'
  if (window.__codemobileWsMonitorInstalled) return
  window.__codemobileWsMonitorInstalled = true

  var OriginalWebSocket = window.WebSocket
  var openCount = 0
  var lastStatus = null

  function postStatus(status, sessionId) {
    var msg = JSON.stringify({
      type: 'codemobile:ws:status',
      status: status,
      sessionId: sessionId || undefined
    })
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(msg)
      }
    } catch (_) {}
  }

  function extractSessionId(url) {
    try {
      var pathname = new URL(url).pathname
      var match = pathname.match(/\\/ws\\/([^/?#]+)/)
      return match ? decodeURIComponent(match[1]) : undefined
    } catch (_) {
      return undefined
    }
  }

  window.WebSocket = function(url, protocols) {
    var sessionId = extractSessionId(typeof url === 'string' ? url : String(url))
    var socket = new OriginalWebSocket(url, protocols)

    socket.addEventListener('open', function() {
      openCount++
      if (openCount === 1 || lastStatus !== 'connected') {
        postStatus('connected', sessionId)
      }
      lastStatus = 'connected'
    })

    socket.addEventListener('close', function() {
      openCount = Math.max(0, openCount - 1)
      if (openCount <= 0) {
        postStatus('disconnected', sessionId)
        lastStatus = 'disconnected'
      }
    })

    socket.addEventListener('error', function() {
      if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        openCount = Math.max(0, openCount - 1)
        if (openCount <= 0) {
          postStatus('disconnected', sessionId)
          lastStatus = 'disconnected'
        }
      }
    })

    return socket
  }

  // Copy static properties from the original WebSocket
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING
  window.WebSocket.OPEN = OriginalWebSocket.OPEN
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED
  window.WebSocket.prototype = OriginalWebSocket.prototype
})()
`.trim()
}
