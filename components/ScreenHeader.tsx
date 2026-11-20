import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { spacing, radius } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  title: string;
  subtitle?: string;
  /** Small text above the title (e.g. a greeting). */
  eyebrow?: string;
  onBack?: () => void;
  right?: { icon: IconName; label: string; onPress: () => void };
  /** Custom node rendered on the right (takes precedence over `right`). */
  rightNode?: React.ReactNode;
}

/** One header used by every top-level screen so titles, spacing and actions line up. */
export function ScreenHeader({ title, subtitle, eyebrow, onBack, right, rightNode }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {onBack && (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
      )}
      <View style={styles.text}>
        {eyebrow ? (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{eyebrow}</Text>
        ) : null}
        <Text style={[typography.h1, { color: colors.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>{subtitle}</Text>
        ) : null}
      </View>
      {rightNode ??
        (right && (
          <Pressable
            onPress={right.onPress}
            accessibilityRole="button"
            accessibilityLabel={right.label}
            style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <Ionicons name={right.icon} size={20} color={colors.textPrimary} />
          </Pressable>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  text: { flex: 1 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
