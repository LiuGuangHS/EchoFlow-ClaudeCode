import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'

/**
 * Bridge message from the WebView when a file input is clicked.
 */
export type FilePickRequestMessage = {
  type: 'codemobile:file:pick'
}

export function isFilePickRequest(msg: unknown): msg is FilePickRequestMessage {
  if (!msg || typeof msg !== 'object') return false
  return (msg as Record<string, unknown>).type === 'codemobile:file:pick'
}

/**
 * JavaScript injected into the WebView that intercepts clicks on
 * `<input type="file">` elements and forwards them to the React Native
 * layer via postMessage.
 */
export function createFilePickerScript(): string {
  return `
(function() {
  'use strict'
  if (window.__codemobileFilePickerInstalled) return
  window.__codemobileFilePickerInstalled = true

  document.addEventListener('click', function(e) {
    var target = e.target
    while (target) {
      if (target.tagName === 'INPUT' && target.type === 'file') {
        e.preventDefault()
        e.stopPropagation()
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: 'codemobile:file:pick' })
        )
        return
      }
      target = target.parentElement
    }
  }, true)
})()
`.trim()
}

export type FilePickResult = {
  /** Injected JS snippet that creates the File object in the WebView */
  injectScript: string
} | null

/**
 * Open the native document picker, read the file as base64 in the RN layer,
 * then return a JS snippet that injects the file into the WebView DOM.
 */
export async function launchNativeFilePicker(): Promise<FilePickResult> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    })

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null
    }

    const asset = result.assets[0]
    const { uri, name, mimeType } = asset

    // Read file as base64 in RN layer (bypasses WebView CORS for content:// URIs)
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    })

    const fileName = JSON.stringify(name ?? 'file')
    const fileType = JSON.stringify(mimeType ?? 'application/octet-stream')

    return {
      injectScript: `
(function() {
  var inputs = document.querySelectorAll('input[type="file"]')
  if (!inputs.length) return
  var input = inputs[0]
  var base64 = ${JSON.stringify(base64)}
  var fileName = ${fileName}
  var fileType = ${fileType}

  try {
    var byteChars = atob(base64)
    var byteArrays = []
    for (var i = 0; i < byteChars.length; i++) {
      byteArrays.push(byteChars.charCodeAt(i))
    }
    var blob = new Blob([new Uint8Array(byteArrays)], { type: fileType })
    var file = new File([blob], fileName, { type: fileType })
    var dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  } catch(err) {
    console.error('CodeMobile file picker error:', err)
  }
})()
`.trim(),
    }
  } catch {
    return null
  }
}
