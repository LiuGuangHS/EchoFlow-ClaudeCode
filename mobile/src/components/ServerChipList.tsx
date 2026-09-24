import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'

type ServerChipListProps = {
  servers: string[]
  onSelect: (serverUrl: string) => void
}

export function ServerChipList({ servers, onSelect }: ServerChipListProps) {
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

const styles = StyleSheet.create({
  container: {
    gap: 8,
    paddingBottom: 8,
  },
  chip: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: 220,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
})
