import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { useTheme } from '../lib/theme'

type ServerChipListProps = {
  servers: string[]
  onSelect: (serverUrl: string) => void
}

export function ServerChipList({ servers, onSelect }: ServerChipListProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  if (servers.length === 0) return null

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {servers.map((serverUrl) => (
        <Pressable
          key={serverUrl}
          accessibilityLabel={`Recent server: ${serverUrl}`}
          onPress={() => onSelect(serverUrl)}
          style={styles.chip}
        >
          <Text numberOfLines={1} style={styles.chipText}>{serverUrl}</Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
  container: {
    gap: 8,
    paddingBottom: 8,
  },
  chip: {
    backgroundColor: theme.chipBg,
    borderColor: theme.chipBorder,
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: 220,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: {
    color: theme.chipText,
    fontSize: 13,
    fontWeight: '600',
  },
  })
}
