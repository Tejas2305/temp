import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/Card';
import { ScreenHeader } from '@/components/ScreenHeader';
import { spacing, radius } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export default function Home() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  const greetingName = user?.display_name
    ? user.display_name.split(' ')[0]
    : user?.email
    ? user.email.split('@')[0]
    : null;

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow={greetingName ? `Namaste, ${greetingName} 🙏` : 'Namaste 🙏'}
          title="Ready to sign?"
          right={{ icon: 'settings-outline', label: 'Settings', onPress: () => router.push('/settings') }}
        />

        <Pressable
          onPress={() => router.push('/(tabs)/recognize')}
          style={[styles.hero, { backgroundColor: colors.primary }]}
          accessibilityLabel="Recognize a sign"
        >
          <View style={styles.heroContent}>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroTitle}>Recognize a Sign</Text>
              <Text style={styles.heroSub}>Point your camera at an ISL sign</Text>
            </View>
            <View style={styles.heroIcon}>
              <Ionicons name="scan" size={26} color="#FFFFFF" />
            </View>
          </View>
        </Pressable>

        {/* AI ISL Academy */}
        <Pressable
          onPress={() => router.push('/ai-learn')}
          accessibilityLabel="AI ISL Personalized Learning Academy"
          style={({ pressed }) => ({ marginTop: spacing.md, opacity: pressed ? 0.9 : 1 })}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={[styles.academyIcon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="sparkles" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[typography.h3, { color: colors.textPrimary }]}>AI ISL Academy</Text>
                <View style={[styles.newPill, { backgroundColor: colors.primary }]}>
                  <Text style={styles.newPillText}>NEW</Text>
                </View>
              </View>
              <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 3 }]}>
                Personalized roadmap, lessons & quizzes
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Card>
        </Pressable>

        <View style={styles.row}>
          <ShortcutCard
            icon="book-outline"
            title="Learn"
            subtitle="Alphabets & numbers"
            onPress={() => router.push('/(tabs)/learn')}
          />
          <ShortcutCard
            icon="cube-outline"
            title="3D Studio"
            subtitle="Numbers 1–9 in 3D"
            onPress={() => router.push('/learn-3d')}
          />
        </View>

        <Text
          style={[
            typography.h3,
            { color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.md },
          ]}
        >
          Continue learning
        </Text>
        <Pressable onPress={() => router.push('/lesson/A')} accessibilityLabel="Continue learning sign A">
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.lessonBadge, { backgroundColor: colors.primarySoft }]}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 20 }}>A</Text>
              </View>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[typography.bodyStrong, { color: colors.textPrimary }]}>
                  Alphabets — Sign Studio
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}
                >
                  Letter to 3D Avatar • AI Verified
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </Card>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function ShortcutCard({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.shortcut, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityLabel={title}
    >
      <View style={[styles.shortcutIcon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={[typography.bodyStrong, { color: colors.textPrimary, marginTop: spacing.md }]}>
        {title}
      </Text>
      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    shadowColor: '#F45B16',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 5,
  },
  academyIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  newPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  newPillText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  shortcutIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  heroContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroTextWrap: { flex: 1 },
  heroTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4 },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  shortcut: { flex: 1, borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg },
  lessonBadge: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});