package com.echoflow.code.mobile

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebStorage
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import java.util.concurrent.Executors

class MainActivity : Activity() {
  private val background = Color.rgb(11, 16, 32)
  private val surface = Color.rgb(20, 28, 51)
  private val border = Color.rgb(51, 65, 99)
  private val text = Color.rgb(244, 247, 255)
  private val muted = Color.rgb(164, 176, 205)
  private val primary = Color.rgb(105, 92, 255)
  private val danger = Color.rgb(245, 112, 112)

  private lateinit var credentials: CredentialStore
  private val executor = Executors.newSingleThreadExecutor()
  private var webView: WebView? = null
  private var filePathCallback: android.webkit.ValueCallback<Array<Uri>>? = null
  private var pendingFileChooser: WebChromeClient.FileChooserParams? = null
  private val permissionRequests = LinkedHashMap<String, org.json.JSONObject>()
  private var permissionDialog: AlertDialog? = null
  private var activePermissionId: String? = null
  private val permissionSession = PermissionSession(
    onRequest = { request -> runOnUiThread { enqueuePermission(request) } },
    onCancel = { requestId -> runOnUiThread { cancelPermission(requestId) } },
  )
  private var lastServerUrl = ""

  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    window.statusBarColor = background
    window.navigationBarColor = background
    credentials = CredentialStore(this)

    val incoming = Connection.parseIntent(intent?.data)
    val saved = credentials.load()
    if (incoming != null) {
      showConnect(incoming.serverUrl, incoming.h5Token)
    } else if (saved != null) {
      showWeb(saved)
    } else {
      showConnect()
    }
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    Connection.parseIntent(intent?.data)?.let {
      credentials.clear()
      showConnect(it.serverUrl, it.h5Token)
    }
  }

  private fun showConnect(serverUrl: String = lastServerUrl, h5Token: String = "") {
    filePathCallback?.onReceiveValue(null)
    filePathCallback = null
    pendingFileChooser = null
    webView?.destroy()
    webView = null
    lastServerUrl = serverUrl

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(background)
      setPadding(dp(20), dp(26), dp(20), dp(20))
    }

    val scroll = ScrollView(this).apply { isFillViewport = true }
    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_VERTICAL
      layoutParams = ViewGroup.LayoutParams(-1, -1)
    }
    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(22), dp(24), dp(22), dp(22))
      background = rounded(surface, dp(22), border)
    }
    card.addView(label("ECHOFLOW CODE", primary, 12f))
    card.addView(label("连接你的 Agent 工作区", text, 26f).also { it.setPadding(0, dp(8), 0, dp(8)) })
    card.addView(label("输入桌面服务地址和 H5 Token，手机会直接打开完整的 EchoFlow 工作台。", muted, 14f))

    val serverInput = input("服务器地址", "http://192.168.1.10:3456", serverUrl)
    val tokenInput = input("H5 Token", "h5_...", h5Token).also {
      it.second.inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
    }
    card.addView(serverInput.first, marginTop = 22)
    card.addView(serverInput.second, marginTop = 8)
    card.addView(tokenInput.first, marginTop = 16)
    card.addView(tokenInput.second, marginTop = 8)

    val scan = Button(this).apply {
      text = "扫描连接二维码"
      setTextColor(primary)
      textSize = 13f
      isAllCaps = false
      background = rounded(Color.TRANSPARENT, dp(12), Color.TRANSPARENT)
      setOnClickListener {
        GmsBarcodeScanning.getClient(this@MainActivity).startScan()
          .addOnSuccessListener { barcode ->
            val parsed = Connection.parseIntent(runCatching { Uri.parse(barcode.rawValue) }.getOrNull())
            if (parsed == null) {
              Toast.makeText(this@MainActivity, "二维码不是有效的 EchoFlow 连接链接", Toast.LENGTH_SHORT).show()
            } else {
              serverInput.second.setText(parsed.serverUrl)
              tokenInput.second.setText(parsed.h5Token)
            }
          }
          .addOnFailureListener {
            if (it !is ApiException || it.statusCode != CommonStatusCodes.CANCELED) {
              Toast.makeText(this@MainActivity, "二维码扫描器暂不可用，可粘贴连接链接", Toast.LENGTH_SHORT).show()
            }
          }
      }
    }
    card.addView(scan, marginTop = 6)

    val paste = Button(this).apply {
      text = "从剪贴板粘贴连接信息"
      setTextColor(muted)
      textSize = 13f
      isAllCaps = false
      background = rounded(Color.TRANSPARENT, dp(12), border)
      setOnClickListener {
        val clipboard = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val value = clipboard.primaryClip?.getItemAt(0)?.coerceToText(this@MainActivity)?.toString().orEmpty()
        val parsed = Connection.parseIntent(runCatching { Uri.parse(value) }.getOrNull())
        if (parsed == null) {
          Toast.makeText(this@MainActivity, "剪贴板中没有有效的连接链接", Toast.LENGTH_SHORT).show()
        } else {
          serverInput.second.setText(parsed.serverUrl)
          tokenInput.second.setText(parsed.h5Token)
        }
      }
    }
    card.addView(paste, marginTop = 16)

    val status = label("", danger, 13f).apply { visibility = View.GONE }
    card.addView(status, marginTop = 14)
    lateinit var connect: Button
    connect = Button(this).apply {
      text = "连接工作台"
      setTextColor(Color.WHITE)
      textSize = 15f
      isAllCaps = false
      background = rounded(primary, dp(14), Color.TRANSPARENT)
      setOnClickListener {
        setConnecting(true, connect, status)
        executor.execute {
          runCatching {
            val token = tokenInput.second.text.toString().trim()
            SavedCredentials(
              Connection.verify(serverInput.second.text.toString(), token),
              token,
            ).also(credentials::save)
          }
            .onSuccess { saved -> runOnUiThread { showWeb(saved) } }
            .onFailure { error ->
              runOnUiThread {
                setConnecting(false, connect, status)
                status.text = error.message ?: "连接失败"
                status.visibility = View.VISIBLE
              }
            }
        }
      }
    }
    card.addView(connect, marginTop = 18)
    content.addView(card, LinearLayout.LayoutParams(-1, -2))
    scroll.addView(content)
    root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
    setContentView(root)
  }

  private fun showWeb(saved: SavedCredentials) {
    lastServerUrl = saved.serverUrl
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(background)
    }
    val toolbar = LinearLayout(this).apply {
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(14), dp(10), dp(10), dp(10))
      setBackgroundColor(surface)
    }
    val titleGroup = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    titleGroup.addView(label("EchoFlow Code", text, 15f))
    titleGroup.addView(label(saved.serverUrl, muted, 11f).also { it.maxLines = 1; it.ellipsize = android.text.TextUtils.TruncateAt.MIDDLE })
    toolbar.addView(titleGroup, LinearLayout.LayoutParams(0, -2, 1f))
    val reload = toolbarButton("↻") { webView?.reload() }
    val disconnect = toolbarButton("退出") {
      clearPermissionRequests()
      permissionSession.disconnect()
      credentials.clear()
      CookieManager.getInstance().removeAllCookies(null)
      CookieManager.getInstance().flush()
      WebStorage.getInstance().deleteAllData()
      showConnect(saved.serverUrl)
    }
    toolbar.addView(reload)
    toolbar.addView(disconnect, LinearLayout.LayoutParams(-2, dp(40)).also { it.leftMargin = dp(6) })
    root.addView(toolbar)

    val frame = FrameLayout(this)
    val loading = ProgressBar(this).apply {
      isIndeterminate = true
      visibility = View.VISIBLE
    }
    frame.addView(loading, FrameLayout.LayoutParams(dp(42), dp(42), Gravity.CENTER))
    val view = WebView(this).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.allowFileAccess = false
      settings.allowContentAccess = true
      settings.setSupportZoom(false)
      settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
      CookieManager.getInstance().setAcceptCookie(true)
      webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
          val uri = request.url
          if (uri.scheme == "http" || uri.scheme == "https") {
            val origin = Uri.parse(saved.serverUrl)
            val sameOrigin = uri.scheme == origin.scheme && uri.host == origin.host && uri.port == origin.port
            return if (sameOrigin) false else runCatching {
              startActivity(Intent(Intent.ACTION_VIEW, uri))
              true
            }.getOrDefault(true)
          }
          return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
          permissionSession.disconnect()
          clearPermissionRequests()
          loading.visibility = View.VISIBLE
          view.evaluateJavascript(sessionMonitorScript, null)
        }

        override fun onPageFinished(view: WebView, url: String) {
          loading.visibility = View.GONE
          view.evaluateJavascript(sessionMonitorScript, null)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
          if (request.isForMainFrame) {
            loading.visibility = View.GONE
            Toast.makeText(this@MainActivity, "H5 加载失败：${error.description}", Toast.LENGTH_LONG).show()
          }
        }
      }
      webChromeClient = object : WebChromeClient() {
        override fun onShowFileChooser(
          view: WebView,
          callback: android.webkit.ValueCallback<Array<Uri>>,
          params: WebChromeClient.FileChooserParams,
        ): Boolean {
          filePathCallback?.onReceiveValue(null)
          filePathCallback = callback
          pendingFileChooser = params
          return runCatching {
            startActivityForResult(params.createIntent(), FILE_PICKER_REQUEST)
            true
          }.getOrElse {
            filePathCallback = null
            pendingFileChooser = null
            false
          }
        }
      }
    }
    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      WebViewCompat.addWebMessageListener(
        view,
        "EchoFlowMobile",
        setOf(Connection.originRule(saved.serverUrl)),
        WebViewCompat.WebMessageListener { _, message, sourceOrigin, isMainFrame, _ ->
          val sessionId = message.data
          if (isMainFrame && sessionId.isNotBlank() && sessionId.length <= 200 &&
            Connection.isSameOrigin(saved.serverUrl, sourceOrigin.toString())
          ) {
            runOnUiThread { permissionSession.connect(saved.serverUrl, saved.h5Token, sessionId) }
          }
        },
      )
    }
    webView = view
    frame.addView(view, FrameLayout.LayoutParams(-1, -1))
    root.addView(frame, LinearLayout.LayoutParams(-1, 0, 1f))
    setContentView(root)
    view.loadUrl(Connection.launchUrl(saved))
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != FILE_PICKER_REQUEST) return
    val result = pendingFileChooser?.parseResult(resultCode, data)
    filePathCallback?.onReceiveValue(result)
    filePathCallback = null
    pendingFileChooser = null
  }

  @Deprecated("Android calls this for legacy Activity navigation")
  override fun onBackPressed() {
    if (webView?.canGoBack() == true) webView?.goBack() else super.onBackPressed()
  }

  override fun onDestroy() {
    permissionSession.destroy()
    clearPermissionRequests()
    filePathCallback?.onReceiveValue(null)
    filePathCallback = null
    pendingFileChooser = null
    webView?.destroy()
    executor.shutdownNow()
    super.onDestroy()
  }

  private fun setConnecting(connecting: Boolean, button: Button, status: TextView) {
    button.isEnabled = !connecting
    button.text = if (connecting) "正在验证…" else "连接工作台"
    if (connecting) status.visibility = View.GONE
  }

  private fun enqueuePermission(request: org.json.JSONObject) {
    val requestId = request.optString("request_id")
    if (requestId.isBlank() || permissionRequests.containsKey(requestId)) return
    permissionRequests[requestId] = request
    showNextPermission()
  }

  private fun showNextPermission() {
    if (permissionDialog != null) return
    val (requestId, request) = permissionRequests.entries.firstOrNull() ?: return
    activePermissionId = requestId
    val toolName = request.optString("tool_name", "Agent 操作")
    val description = request.optString("description")
    val input = request.optJSONObject("input")?.toString(2).orEmpty()
    val details = listOf(toolName, description, input).filter(String::isNotBlank).joinToString("\n\n")
    permissionDialog = AlertDialog.Builder(this)
      .setTitle("确认 Agent 操作")
      .setMessage(details)
      .setPositiveButton("允许") { _, _ -> resolvePermission(requestId, true) }
      .setNegativeButton("拒绝") { _, _ -> resolvePermission(requestId, false) }
      .setCancelable(false)
      .create()
      .also(AlertDialog::show)
  }

  private fun resolvePermission(requestId: String, allowed: Boolean) {
    permissionSession.respond(requestId, allowed)
    permissionRequests.remove(requestId)
    permissionDialog = null
    activePermissionId = null
    showNextPermission()
  }

  private fun cancelPermission(requestId: String) {
    permissionRequests.remove(requestId)
    if (activePermissionId == requestId) {
      permissionDialog?.dismiss()
      permissionDialog = null
      activePermissionId = null
      showNextPermission()
    }
  }

  private fun clearPermissionRequests() {
    permissionRequests.clear()
    permissionDialog?.dismiss()
    permissionDialog = null
    activePermissionId = null
  }

  private val sessionMonitorScript = """
    (function() {
      if (window.__echoflowMobileSessionMonitor) return;
      if (!window.WebSocket) return;
      window.__echoflowMobileSessionMonitor = true;
      var OriginalWebSocket = window.WebSocket;
      function MobileWebSocket(url, protocols) {
        try {
          var parsed = new URL(typeof url === 'string' ? url : String(url), window.location.href);
          var match = parsed.pathname.match(/\/ws\/([^/?#]+)/);
          if (match && window.EchoFlowMobile && match[1].length <= 200) {
            window.EchoFlowMobile.postMessage(decodeURIComponent(match[1]));
          }
        } catch (_) {}
        return protocols === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols);
      }
      MobileWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
      MobileWebSocket.OPEN = OriginalWebSocket.OPEN;
      MobileWebSocket.CLOSING = OriginalWebSocket.CLOSING;
      MobileWebSocket.CLOSED = OriginalWebSocket.CLOSED;
      MobileWebSocket.prototype = OriginalWebSocket.prototype;
      window.WebSocket = MobileWebSocket;
    })();
  """.trimIndent()

  private fun input(title: String, hint: String, value: String): Pair<TextView, EditText> {
    return label(title, muted, 12f) to EditText(this).apply {
      setText(value)
      setHint(hint)
      setHintTextColor(Color.rgb(105, 118, 150))
      setTextColor(this@MainActivity.text)
      textSize = 15f
      setSingleLine(true)
      setPadding(dp(14), 0, dp(14), 0)
      background = rounded(surface, dp(12), border)
    }
  }

  private fun label(value: String, color: Int, size: Float) = TextView(this).apply {
    text = value
    setTextColor(color)
    textSize = size
  }

  private fun toolbarButton(value: String, action: () -> Unit) = Button(this).apply {
    text = value
    setTextColor(this@MainActivity.text)
    textSize = 12f
    isAllCaps = false
    background = rounded(Color.TRANSPARENT, dp(10), border)
    setOnClickListener { action() }
  }

  private fun rounded(fill: Int, radius: Int, stroke: Int): GradientDrawable = GradientDrawable().apply {
    setColor(fill)
    cornerRadius = radius.toFloat()
    if (stroke != Color.TRANSPARENT) setStroke(dp(1), stroke)
  }

  private fun LinearLayout.addView(view: View, marginTop: Int = 0) {
    addView(view, LinearLayout.LayoutParams(-1, if (view is EditText) dp(48) else -2).apply { topMargin = marginTop })
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  companion object {
    private const val FILE_PICKER_REQUEST = 4107
  }
}
