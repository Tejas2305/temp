import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { spacing, radius } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { loadHistory, clearHistory, HistoryEntry } from '@/services/storage';

export default function History() {
  const { colors } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<HistoryEntry[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      loadHistory().then(setItems);
    }, []),
  );

  const confirmClear = () =>
    Alert.alert('Clear history', 'Remove all recognized letters from this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => clearHistory().then(() => setItems([])) },
    ]);

  return (
    <Screen edges={['top']}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 }}
        ListHeaderComponent={
          <ScreenHeader
            title="History"
            subtitle={items.length ? `${items.length} recent letters` : 'Letters you recognize appear here'}
            right={items.length ? { icon: 'trash-outline', label: 'Clear history', onPress: confirmClear } : undefined}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="time-outline" size={34} color={colors.primary} />
            </View>
            <Text style={[typography.h2, { color: colors.textPrimary, marginTop: spacing.lg }]}>No history yet</Text>
            <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }]}>
              Start signing and every letter you recognize will be saved here.
            </Text>
            <View style={{ marginTop: spacing.xl }}>
              <Button label="Start recognizing" onPress={() => router.push('/(tabs)/recognize')} />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.row}>
            <View style={[styles.letter, { backgroundColor: colors.primarySoft }]}>
              <Text style={[styles.letterText, { color: colors.primary }]}>{item.sign}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyStrong, { color: colors.textPrimary }]}>
                {Math.round(item.confidence * 100)}% confidence
              </Text>
              <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
                {new Date(item.timestamp).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          </Card>
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  letter: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  letterText: { fontSize: 22, fontWeight: '800' },
});
