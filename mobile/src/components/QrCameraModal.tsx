import { useEffect, useState } from 'react'
import { Modal, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'

type QrCameraModalProps = {
  visible: boolean
  onClose: () => void
  onScan: (data: string) => void
  scanError?: string
}

export function QrCameraModal({ visible, onClose, onScan, scanError }: QrCameraModalProps) {
  const [scanned, setScanned] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()

  useEffect(() => {
    if (!visible) {
      setScanned(false)
      return
    }

    if (!permission || (!permission.granted && permission.canAskAgain)) {
      void requestPermission()
    }
  }, [permission, requestPermission, visible])

  const handleBarCodeScanned = (result: BarcodeScanningResult) => {
    if (scanned) return
    setScanned(true)
    onScan(result.data)
  }

  const handleClose = () => {
    setScanned(false)
    onClose()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={styles.container}>
        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          >
            <ScannerOverlay
              scanError={scanError}
              scanned={scanned}
              onClose={handleClose}
              onRescan={() => setScanned(false)}
            />
          </CameraView>
        ) : (
          <View style={styles.overlay}>
            <View style={styles.header}>
              <Pressable
                accessibilityLabel="关闭二维码扫描"
                onPress={handleClose}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={26} color="#fff" />
              </Pressable>
              <Text style={styles.headerTitle}>扫描二维码</Text>
              <View style={styles.closeButton} />
            </View>

            <View style={styles.permissionPanel}>
              <View style={styles.permissionIcon}>
                <Ionicons name="camera-outline" size={34} color="#fff" />
              </View>
              <Text style={styles.permissionTitle}>
                {permission ? '需要相机权限' : '正在准备相机...'}
              </Text>
              <Text style={styles.permissionText}>
                {permission?.canAskAgain === false
                  ? '请在系统设置中开启相机权限，然后返回继续扫描。'
                  : '请允许相机权限，用于扫描 EchoFlow 桌面端显示的二维码。'}
              </Text>
              {permission?.canAskAgain !== false ? (
                <Pressable
                  accessibilityLabel="允许相机权限"
                  onPress={() => void requestPermission()}
                  style={styles.permissionButton}
                >
                  <Text style={styles.permissionButtonText}>允许相机权限</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      </View>
    </Modal>
  )
}

type ScannerOverlayProps = {
  scanned: boolean
  scanError?: string
  onClose: () => void
  onRescan: () => void
}

function ScannerOverlay({ scanned, scanError, onClose, onRescan }: ScannerOverlayProps) {
  return (
    <View style={styles.overlay}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="关闭二维码扫描"
          onPress={onClose}
          style={styles.closeButton}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>扫描二维码</Text>
        <View style={styles.closeButton} />
      </View>

      <View style={styles.scanArea}>
        <View style={styles.scanFrame}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
        </View>
        <Text style={styles.hint}>
          将相机对准 EchoFlow 桌面端 H5 接入设置里的二维码。
        </Text>
      </View>

      {scanError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{scanError}</Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        {scanned && !scanError ? (
          <Text style={styles.scannedText}>已识别二维码，正在处理...</Text>
        ) : null}
        <Pressable
          accessibilityLabel="重新扫描"
          disabled={!scanned}
          onPress={onRescan}
          style={[styles.rescanButton, !scanned ? styles.rescanButtonDisabled : null]}
        >
          <Ionicons
            name="refresh"
            size={16}
            color="#fff"
            style={!scanned ? styles.rescanIconDisabled : null}
          />
          <Text style={[styles.rescanButtonText, !scanned ? styles.rescanButtonTextDisabled : null]}>
            重新扫描
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: (Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 36) + 14,
    paddingBottom: 14,
  },
  closeButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  scanArea: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  scanFrame: {
    aspectRatio: 1,
    maxHeight: 260,
    maxWidth: 260,
    position: 'relative',
    width: '70%',
  },
  corner: {
    borderColor: '#2563eb',
    height: 24,
    position: 'absolute',
    width: 24,
  },
  topLeft: {
    borderLeftWidth: 3,
    borderTopWidth: 3,
    left: 0,
    top: 0,
  },
  topRight: {
    borderRightWidth: 3,
    borderTopWidth: 3,
    right: 0,
    top: 0,
  },
  bottomLeft: {
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    bottom: 0,
    left: 0,
  },
  bottomRight: {
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: 0,
    right: 0,
  },
  hint: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 28,
    textAlign: 'center',
  },
  errorBanner: {
    backgroundColor: 'rgba(185,28,28,0.85)',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
  },
  errorText: {
    color: '#fff',
    fontSize: 13,
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingBottom: 40,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  scannedText: {
    color: '#4ade80',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  rescanButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  rescanButtonDisabled: {
    opacity: 0.4,
  },
  rescanButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  rescanButtonTextDisabled: {
    opacity: 0.4,
  },
  rescanIconDisabled: {
    opacity: 0.4,
  },
  permissionPanel: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  permissionIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(37,99,235,0.9)',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    marginBottom: 16,
    width: 52,
  },
  permissionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  permissionText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 22,
    textAlign: 'center',
  },
  permissionButton: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
})
