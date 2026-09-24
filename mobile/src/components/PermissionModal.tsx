import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { PermissionRequest } from '../lib/permissionClient'
import { t } from '../lib/i18n'

type PermissionModalProps = {
  request: PermissionRequest
  onAllow: () => void
  onDeny: () => void
}

export function PermissionModal({ request, onAllow, onDeny }: PermissionModalProps) {
  const inputKeys = Object.keys(request.input).filter((k) => k !== 'command')
  const command = typeof request.input.command === 'string' ? request.input.command : null

  return (
    <Modal
      visible
      animationType="fade"
      transparent
      onRequestClose={onDeny}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={[styles.badge, styles.toolBadge]}>
              <Text style={styles.badgeText}>{request.toolName}</Text>
            </View>
            <Text style={styles.title}>{t('permission.title')}</Text>
          </View>

          {request.description ? (
            <Text style={styles.description}>{request.description}</Text>
          ) : null}

          {command ? (
            <View style={styles.commandBox}>
              <Text style={styles.commandLabel}>{t('permission.command')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.commandScroll}
              >
                <Text style={styles.commandText}>{command}</Text>
              </ScrollView>
            </View>
          ) : null}

          {inputKeys.length > 0 ? (
            <View style={styles.inputsBox}>
              <Text style={styles.commandLabel}>{t('permission.details')}</Text>
              {inputKeys.map((key) => (
                <View key={key} style={styles.inputRow}>
                  <Text style={styles.inputKey}>{key}</Text>
                  <Text style={styles.inputValue} numberOfLines={2}>
                    {JSON.stringify(request.input[key])}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityLabel={t('permission.deny')}
              onPress={onDeny}
              style={styles.denyButton}
            >
              <Text style={styles.denyButtonText}>{t('permission.deny')}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={t('permission.allow')}
              onPress={onAllow}
              style={styles.allowButton}
            >
              <Text style={styles.allowButtonText}>{t('permission.allow')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    maxHeight: '80%',
    maxWidth: 400,
    padding: 22,
    width: '100%',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 14,
  },
  badge: {
    borderRadius: 8,
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  toolBadge: {
    backgroundColor: '#dbeafe',
  },
  badgeText: {
    color: '#1e40af',
    fontSize: 14,
    fontWeight: '800',
  },
  title: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  description: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
    textAlign: 'center',
  },
  commandBox: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  commandLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  commandScroll: {
    maxHeight: 80,
  },
  commandText: {
    color: '#0f172a',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19,
  },
  inputsBox: {
    marginBottom: 16,
  },
  inputRow: {
    marginBottom: 8,
  },
  inputKey: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  inputValue: {
    color: '#334155',
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  denyButton: {
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
  },
  denyButtonText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '700',
  },
  allowButton: {
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 12,
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
  },
  allowButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
})
