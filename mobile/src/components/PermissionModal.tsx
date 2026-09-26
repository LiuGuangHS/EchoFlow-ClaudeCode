import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { PermissionRequest } from '../lib/permissionClient'
import { t } from '../lib/i18n'
import { useTheme } from '../lib/theme'

type PermissionModalProps = {
  request: PermissionRequest
  onAllow: () => void
  onDeny: () => void
}

export function PermissionModal({ request, onAllow, onDeny }: PermissionModalProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const inputKeys = Object.keys(request.input).filter((k) => k !== 'command')
  const command = typeof request.input.command === 'string' ? request.input.command : null

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={onDeny}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.badge}>
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

function createStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
  backdrop: {
    alignItems: 'stretch',
    backgroundColor: theme.modalBackdrop,
    flex: 1,
    justifyContent: 'flex-end',
    padding: 12,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 22,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    maxHeight: '82%',
    maxWidth: 400,
    padding: 22,
    width: '100%',
    shadowColor: theme.shadowColor,
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
    backgroundColor: theme.scanButtonBg,
    borderRadius: 8,
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: theme.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  title: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  description: {
    color: theme.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
    textAlign: 'center',
  },
  commandBox: {
    backgroundColor: theme.codeBg,
    borderColor: theme.codeBorder,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  commandLabel: {
    color: theme.textMuted,
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
    color: theme.codeText,
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
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  inputValue: {
    color: theme.textSecondary,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  denyButton: {
    alignItems: 'center',
    backgroundColor: theme.mutedButtonBg,
    borderRadius: 12,
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
  },
  denyButtonText: {
    color: theme.mutedButtonText,
    fontSize: 15,
    fontWeight: '700',
  },
  allowButton: {
    alignItems: 'center',
    backgroundColor: theme.primary,
    borderRadius: 12,
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
  },
  allowButtonText: {
    color: theme.toolbarText,
    fontSize: 15,
    fontWeight: '700',
  },
  })
}
